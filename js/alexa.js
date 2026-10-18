// js/alexa.js — voice control via a local whisper WebSocket server (server.py)
import { showToast } from './utils.js';
import { drawStaticRobot, drawLandingMarkers, getLandingMarkerPositions } from './robot.js';
import { getAlexaDrill, setAlexaDrill } from './alexaDrill.js';
import { Ball } from './model/index.js';
import { SPIN_LIMITS } from './constants.js';
import { sendSingleBall } from './runner.js';

// The whisper server (server.py) runs on this machine by default.
// Use wss:// when the page itself is served over HTTPS.
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname || 'localhost'}:8765`;

// The Nova Agent service (nova-agent/server.py) — receives voice prompts.
const AGENT_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname || 'localhost'}:8766`;

let active = false;
let ws = null;
let audioCtx = null;
let micStream = null;
let processor = null;
let agentWs = null;
let reqSeq = 0;
let micMuted = false;
let whisperState = 'idle';  // 'connecting' | 'idle' | 'listening'
let agentBusy = false;
let agentError = false;

const el = (id) => document.getElementById(id);

const MEGA_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>';
const EAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 1 1-7 0"/><path d="M15 8.5a2.5 2.5 0 0 0-5 0v1a2 2 0 1 1 0 4"/></svg>';
const REFRESH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>';
const LINK_OFF_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/></svg>';

const STATUS_ICONS = {
    'SAY "ALEXA"': MEGA_ICON,
    'Listening': EAR_ICON,
    'Command': REFRESH_ICON,
    'Thinking…': REFRESH_ICON,
    'Whisper server unreachable': LINK_OFF_ICON,
    'Whisper disconnected': LINK_OFF_ICON,
};

function setStatus(text) {
    const node = el('alexa-status');
    if (!node) return;
    node.innerHTML = STATUS_ICONS[text] || '';
    node.title = text === 'SAY "ALEXA"' ? 'SAY ALEXA' : '';
}

function setCommand(text) {
    const node = el('alexa-command');
    if (node) node.textContent = text;
}

// Combined status: whisper state + agent busy state determine what we show.
function refreshStatus() {
    if (whisperState === 'connecting') {
        setStatus('Connecting to whisper...');
    } else if (whisperState === 'listening') {
        setStatus('Listening');
    } else if (agentBusy) {
        setStatus('Thinking…');
    } else {
        setStatus('SAY "ALEXA"');
    }
    const stop = el('alexa-whisper-stop');
    if (stop) stop.disabled = whisperState !== 'listening';
}

// Safety net: if the whisper server never sends an idle after a wake word
// (e.g. an empty/spurious command), drop back to idle rather than showing
// "Listening" forever.
let listeningWatchdog = null;
const LISTENING_TIMEOUT = 12000; // whisper command_timeout is 10s; allow margin

function armListeningWatchdog() {
    clearTimeout(listeningWatchdog);
    listeningWatchdog = setTimeout(() => {
        if (whisperState === 'listening') {
            whisperState = 'idle';
            refreshStatus();
        }
    }, LISTENING_TIMEOUT);
}

function disarmListeningWatchdog() {
    clearTimeout(listeningWatchdog);
    listeningWatchdog = null;
}

// ── Microphone icon + live level meter ───────────────────────────────────
let _micFillEl = null;
let _micLevelSmooth = 0;
let _micOn = false;

const MIC_MIN_FILL = 10; // % green shown when connected but silent

function setMicLevel(level) {
    // Fast attack, slow decay for a smooth, stable meter.
    const target = Math.max(0, Math.min(1, level));
    _micLevelSmooth = target > _micLevelSmooth
        ? target
        : _micLevelSmooth * 0.82 + target * 0.18;

    let pct = _micLevelSmooth * 100;
    if (!_micOn) pct = 0;
    else if (pct < MIC_MIN_FILL) pct = MIC_MIN_FILL;

    if (!_micFillEl) _micFillEl = el('alexa-mic-fill-wrap');
    if (_micFillEl) _micFillEl.style.height = `${pct}%`;
}

function setMicState(state) {
    const mic = el('alexa-mic');
    if (!mic) return;
    mic.classList.remove('on', 'error');
    if (state) mic.classList.add(state);
    _micOn = state === 'on';
    _micLevelSmooth = 0;
    setMicLevel(0);
}

function setMicMuted(on) {
    micMuted = !!on;
    const mic = el('alexa-mic');
    if (mic) mic.classList.toggle('muted', micMuted);
    if (micStream) {
        micStream.getAudioTracks().forEach((t) => { t.enabled = !micMuted; });
    }
    if (micMuted) setMicLevel(0);
}

function toggleMicMute() {
    setMicMuted(!micMuted);
    if (micMuted) setStatus('');
    else refreshStatus();
}

function showPanel() {
    document.body.classList.add('alexa-active');
    const btn = el('alexa-btn');
    if (btn) btn.classList.add('active');
    drawAlexaTable();
    connectAgent();
}

function hidePanel() {
    document.body.classList.remove('alexa-active');
    const btn = el('alexa-btn');
    if (btn) btn.classList.remove('active');
}

// Stop all resources without hiding the panel (so status/errors stay visible).
function release(closeAgentToo = true) {
    active = false;
    if (processor) { try { processor.disconnect(); } catch (e) {} processor = null; }
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    if (closeAgentToo) closeAgent();
    setMicState(null);
    setMicMuted(false);
    whisperState = 'idle';
    agentBusy = false;
    disarmListeningWatchdog();
    const stop = el('alexa-whisper-stop');
    if (stop) stop.disabled = true;
}

// ── Nova Agent (OpenAI) connection ─────────────────────────────────────────
function connectAgent() {
    if (agentWs && (agentWs.readyState === WebSocket.OPEN || agentWs.readyState === WebSocket.CONNECTING)) return;
    agentError = false;
    agentWs = new WebSocket(AGENT_URL);

    agentWs.onopen = () => {
        agentWs.send(JSON.stringify({ type: 'reset' }));
        setAgentDot('online');
        const box = el('alexa-agent-messages');
        if (box) box.innerHTML = '';
    };

    agentWs.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        handleAgentMessage(msg);
    };

    agentWs.onerror = () => {
        agentError = true;
        setAgentDot('error');
    };

    agentWs.onclose = () => {
        agentWs = null;
        setAgentDot(agentError ? 'error' : null);
    };
}

function closeAgent() {
    if (agentWs) { try { agentWs.close(); } catch (e) {} agentWs = null; }
    setAgentDot(null);
}

function sendToAgent(text) {
    if (!agentWs || agentWs.readyState !== WebSocket.OPEN) {
        setAgentDot('error');
        return;
    }
    agentBusy = true;
    addAgentMessage('user', text);
    setAgentDot('thinking');
    refreshStatus();
    reqSeq += 1;
    agentWs.send(JSON.stringify({
        type: 'prompt',
        id: `alexa-${reqSeq}`,
        prompt: text,
        drill: getAlexaDrill(),
        pause_before: parseFloat(el('input-start-pause')?.value) || 0,
        count: parseInt(el('input-reps')?.value) || 1,
        pause_between: parseFloat(el('input-pause')?.value) || 0,
    }));
}

function cancelAgent() {
    if (agentWs && agentWs.readyState === WebSocket.OPEN) {
        agentWs.send(JSON.stringify({ type: 'cancel' }));
    }
    agentBusy = false;
    setAgentDot('online');
}

function handleAgentMessage(msg) {
    switch (msg.type) {
        case 'user_response':
            if (msg.text) {
                addAgentMessage('agent', msg.text);
            }
            setStatus('Command');
            break;
        case 'update_drill':
            if (msg.drill) {
                setAlexaDrill(msg.drill);
                addAgentMessage('note', '✓ Drill updated');
            }
            break;
        case 'execute_drill':
            setStatus('Executing drill…');
            if (msg.drill) {
                setAlexaDrill(msg.drill);
            }
            // First apply the agent's run settings to the controls.
            if (typeof msg.pause_before === 'number') {
                const i = el('input-start-pause'); if (i) i.value = msg.pause_before;
            }
            if (typeof msg.count === 'number') {
                const i = el('input-reps'); if (i) i.value = msg.count;
            }
            if (typeof msg.pause_between === 'number') {
                const i = el('input-pause'); if (i) i.value = msg.pause_between;
            }
            // Then run the drill.
            if (window.runAlexaDrill) {
                window.runAlexaDrill();
            }
            addAgentMessage('note', '▶ Executing drill');
            break;
        case 'test_ball':
            setStatus('Test ball');
            if (msg.ball) {
                const ball = new Ball(msg.ball);
                ball.ensureMeta();
                ball.clamp();
                const rpm = ball.getRPMs();
                sendSingleBall(rpm.top, rpm.bot, ball.height, ball.drop, ball.frequency, ball.reps)
                    .then((ok) => {
                        addAgentMessage('note', ok ? '• Test ball fired' : '⚠ Test ball: robot not connected');
                    })
                    .catch(() => {
                        addAgentMessage('note', '⚠ Test ball failed');
                    });
            }
            break;
        case 'error':
            if (msg.message) {
                showToast('Nova agent: ' + msg.message);
                addAgentMessage('note', '⚠ ' + msg.message);
            }
            agentBusy = false;
            setStatus('Agent error');
            setAgentDot('error');
            break;
        case 'done':
            agentBusy = false;
            setAgentDot('online');
            refreshStatus();
            break;
        case 'reset':
            setAgentDot('online');
            break;
        case 'cancelled':
            agentBusy = false;
            setAgentDot('online');
            addAgentMessage('note', '✕ Cancelled');
            refreshStatus();
            break;
        default:
            break;
    }
}

// ── Agent prompt box (messages + status dot + reset) ──────────────────────
function setAgentDot(state) {
    const dot = el('alexa-agent-status');
    if (dot) {
        dot.classList.remove('online', 'thinking', 'error');
        if (state) dot.classList.add(state);
    }

    const stop = el('alexa-agent-stop');
    if (stop) stop.disabled = state !== 'thinking';
}

function addAgentMessage(kind, text) {
    const box = el('alexa-agent-messages');
    if (!box || !text) return;
    const div = document.createElement('div');
    div.className = `alexa-agent-msg ${kind}`;
    div.textContent = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

function resetAgent() {
    const box = el('alexa-agent-messages');
    if (box) box.innerHTML = '';
    setAgentDot('online');
    if (agentWs && agentWs.readyState === WebSocket.OPEN) {
        agentWs.send(JSON.stringify({ type: 'reset' }));
    }
    agentBusy = false;
    refreshStatus();
}

function start() {
    if (active) return;
    setCommand('');
    showPanel();
    whisperState = 'connecting';
    setStatus('Connecting to whisper...');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('Mic needs HTTPS or localhost');
        showToast('Mic needs HTTPS or localhost');
        return;
    }

    navigator.mediaDevices
        .getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } })
        .then((stream) => {
            micStream = stream;

            ws = new WebSocket(WS_URL);
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {
                active = true;
                setMicMuted(false);
                setMicState('on');
                whisperState = 'idle';
                refreshStatus();
                startAudio();
            };

            ws.onmessage = (ev) => {
                let msg;
                try { msg = JSON.parse(ev.data); } catch (e) { return; }

                if (msg.type === 'command' && msg.text) {
                    disarmListeningWatchdog();
                    setCommand(msg.text);
                    whisperState = 'idle';
                    setStatus('Prompt');
                    sendToAgent(msg.text);
                } else if (msg.type === 'cancel') {
                    disarmListeningWatchdog();
                    whisperState = 'idle';
                    setStatus('Cancelled');
                    cancelAgent();
                } else if (msg.type === 'status' && msg.status === 'listening') {
                    whisperState = 'listening';
                    armListeningWatchdog();
                    refreshStatus();
                } else if (msg.type === 'status' && msg.status === 'idle') {
                    disarmListeningWatchdog();
                    whisperState = 'idle';
                    refreshStatus();
                }
            };

            ws.onerror = () => {
                release(false);
                setMicState('error');
                setStatus('Whisper server unreachable');
                showToast('Whisper server unreachable');
            };

            ws.onclose = () => {
                const wasActive = active;
                release(false);
                if (wasActive) {
                    setStatus('Whisper disconnected');
                    showToast('Whisper disconnected');
                }
            };
        })
        .catch(() => {
            setStatus('Microphone access denied');
            showToast('Microphone access denied');
        });
}

function startAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const source = audioCtx.createMediaStreamSource(micStream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
        const f32 = e.inputBuffer.getChannelData(0);

        // Live mic level (RMS → dB → 0..1) to fill the microphone icon.
        let sum = 0;
        for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
        const rms = Math.sqrt(sum / f32.length);
        const db = 20 * Math.log10(Math.max(rms, 1e-4)); // ≈ -80..0 dB
        setMicLevel((db + 60) / 55); // -60 dB → 0, -5 dB → 1

        if (micMuted || agentBusy || !ws || ws.readyState !== WebSocket.OPEN) return;
        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
            let s = f32[i];
            if (s > 1) s = 1;
            else if (s < -1) s = -1;
            i16[i] = s * 0x7fff;
        }
        ws.send(i16.buffer);
    };

    // Keep the processor running while outputting silence (avoids mic feedback).
    const mute = audioCtx.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(audioCtx.destination);
}

window.toggleAlexa = () => {
    // Use the panel itself as the source of truth: `active` only becomes true
    // once the whisper socket connects, so a failed connection (or a denied
    // mic) would otherwise leave the panel visible with no way to close it.
    const panelOpen = document.body.classList.contains('alexa-active');
    if (panelOpen || active) {
        release();
        hidePanel();
        setStatus('');
    } else {
        start();
    }
};

// Wire the button after the module loads (module scripts run after DOM parse).
const alexaBtn = el('alexa-btn');
if (alexaBtn) {
    alexaBtn.addEventListener('click', () => window.toggleAlexa());
}

// Nova Agent prompt box: submit + reset.
const agentForm = el('alexa-agent-form');
if (agentForm) {
    agentForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = el('alexa-agent-prompt');
        const text = (input?.value || '').trim();
        if (!text) return;
        input.value = '';
        sendToAgent(text);
    });
}

const agentResetBtn = el('alexa-agent-reset');
if (agentResetBtn) {
    agentResetBtn.addEventListener('click', () => resetAgent());
}

const agentStopBtn = el('alexa-agent-stop');
if (agentStopBtn) {
    agentStopBtn.addEventListener('click', () => cancelAgent());
}

// Mic icon click → mute / unmute.
const micBtn = el('alexa-mic');
if (micBtn) {
    micBtn.addEventListener('click', () => toggleMicMute());
}

// Whisper stop: cancel listening on the whisper server.
const whisperStopBtn = el('alexa-whisper-stop');
if (whisperStopBtn) {
    whisperStopBtn.addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send('cancel');
        }
        whisperState = 'idle';
        disarmListeningWatchdog();
        refreshStatus();
    });
}

// Top-down table view below the Alexa panel (rotated 90° clockwise).
const tableCanvas = el('alexa-table-canvas');
const speedSlider = el('alexa-speed-slider');
const spinSlider = el('alexa-spin-slider');
const heightSlider = el('alexa-height-slider');
const bpmSlider = el('alexa-bpm-slider');
const dropSlider = el('alexa-drop-slider');
const delaySlider = el('alexa-delay-slider');
const scatterSlider = el('alexa-scatter-slider');

let selectedBallIndex = null;
let alexaLandingPositions = [];
let tableDrag = null;

// Match the visible bitmap geometry used by drawAlexaTable():
// bitmap 400x600, table surface y=10..510, net at y=260.
function positionAlexaSliders() {
    if (!tableCanvas) return;
    const body = tableCanvas.closest('.alexa-table-body');
    if (!body) return;
    const cRect = tableCanvas.getBoundingClientRect();
    const bRect = body.getBoundingClientRect();
    if (!cRect.width || !cRect.height) return; // panel hidden

    const bw = tableCanvas.width || 400;
    const bh = tableCanvas.height || 600;
    const scale = Math.min(cRect.width / bw, cRect.height / bh);
    const cw = bw * scale;
    const ch = bh * scale;
    const offX = cRect.left - bRect.left + (cRect.width - cw) / 2;
    const offY = cRect.top - bRect.top;           // object-position: top center

    // Vertical sliders are rotated horizontal ranges: place by their visual
    // left/top and use `width` as the track length (22px thickness).
    const placeV = (el, left, top, length) => {
        if (!el) return;
        const x = Math.max(0, left);
        el.style.left = `${Math.round(x + 22)}px`;  // visual right edge (rotation origin)
        el.style.top = `${Math.round(top)}px`;
        el.style.width = `${Math.round(length)}px`;
        el.style.height = '22px';
    };

    placeV(speedSlider,
        offX + cw * 0.05 - 11,
        offY + ch * (260 / 600),
        ch * ((510 - 260) / 600));

    placeV(spinSlider,
        offX + cw * 0.05 - 11,
        offY + ch * (10 / 600),
        ch * ((260 - 10) / 600));

    // Right side mirrors the left: Height on the top half, BPM on the bottom.
    placeV(heightSlider,
        offX + cw * 0.95 - 11,
        offY + ch * (10 / 600),
        ch * ((260 - 10) / 600));

    placeV(bpmSlider,
        offX + cw * 0.95 - 11,
        offY + ch * (260 / 600),
        ch * ((510 - 260) / 600));

    if (dropSlider) {
        // Horizontal, spanning the table width just below its bottom edge.
        dropSlider.style.left = `${Math.round(offX + cw * (40 / 400))}px`;
        dropSlider.style.top = `${Math.round(offY + ch * (510 / 600) + 6)}px`;
        dropSlider.style.width = `${Math.round(cw * ((360 - 40) / 400))}px`;
        dropSlider.style.height = '22px';
    }
}

// Blend two RGB colors (t = 0..1).
function mixColor(from, to, t) {
    const k = Math.max(0, Math.min(1, t));
    const c = from.map((v, i) => Math.round(v + (to[i] - v) * k));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
const SPEED_SLOW_COLOR = [156, 163, 175]; // gray  – slow
const SPEED_FAST_COLOR = [220, 38, 38];   // red   – fast

function syncAlexaSliders() {
    const ball = selectedBallIndex !== null ? findAlexaBallByIndex(selectedBallIndex) : null;

    if (speedSlider) {
        speedSlider.disabled = !ball;
        if (ball) {
            const speed = ball.speed ?? 2;
            speedSlider.value = String(speed);
            speedSlider.title = `Speed: ${speed}`;
            // Gray while slow, blending to red only in the upper range.
            const t = Math.max(0, Math.min(1, (speed - 3) / 7));
            speedSlider.style.accentColor = mixColor(SPEED_SLOW_COLOR, SPEED_FAST_COLOR, t);
        } else {
            speedSlider.title = 'Select a ball to change its speed';
        }
    }

    if (dropSlider) {
        dropSlider.disabled = !ball;
        if (ball) {
            dropSlider.value = String(ball.drop ?? 0);
            dropSlider.title = `Drop: ${ball.drop ?? 0}`;
        } else {
            dropSlider.title = 'Select a ball to change its drop';
        }
    }

    if (spinSlider) {
        spinSlider.disabled = !ball;
        if (ball) {
            const maxSpin = SPIN_LIMITS[String(ball.speed)] ?? 10;
            spinSlider.max = String(maxSpin);
            spinSlider.value = String(Math.min(ball.spin ?? 0, maxSpin));
            spinSlider.title = `Spin: ${ball.spin ?? 0}`;
            // Green for top spin, red for back spin.
            spinSlider.style.accentColor = ball.type === 'back' ? '#dc2626' : '#16a34a';
        } else {
            spinSlider.title = 'Select a ball to change its spin';
        }
    }

    if (heightSlider) {
        heightSlider.disabled = !ball;
        if (ball) {
            heightSlider.value = String(ball.height ?? 50);
            heightSlider.title = `Height: ${ball.height ?? 50}`;
            heightSlider.style.accentColor = '#0984e3'; // blue while active
        } else {
            heightSlider.title = 'Select a ball to change its height';
        }
    }

    if (bpmSlider) {
        bpmSlider.disabled = !ball;
        if (ball) {
            bpmSlider.value = String(ball.frequency ?? 50);
            bpmSlider.title = `BPM: ${ball.frequency ?? 50}`;
        } else {
            bpmSlider.title = 'Select a ball to change its BPM';
        }
    }

    // Top/Back rotation toggle
    const rotationRow = document.getElementById('alexa-table-rotation');
    const topBtn = document.getElementById('alexa-table-type-top');
    const backBtn = document.getElementById('alexa-table-type-back');
    if (rotationRow) rotationRow.classList.toggle('disabled', !ball);
    if (topBtn) topBtn.classList.toggle('active', !!ball && ball.type !== 'back');
    if (backBtn) backBtn.classList.toggle('active', !!ball && ball.type === 'back');

    // Delay (seconds, 0–3) for the selected ball
    const delayRow = document.getElementById('alexa-table-delay');
    const delayValEl = document.getElementById('alexa-delay-value');
    const delaySec = ball ? Math.min(3, (ball.delay ?? 0) / 1000) : 0;
    if (delayRow) delayRow.classList.toggle('disabled', !ball);
    if (delaySlider) {
        delaySlider.disabled = !ball;
        delaySlider.value = String(Math.round(delaySec * 10) / 10);
        delaySlider.title = ball
            ? `Delay: ${delaySec.toFixed(1)}s`
            : 'Select a ball to change its delay';
    }
    if (delayValEl) delayValEl.textContent = delaySec.toFixed(1);

    // Scatter (0–10, same max as drop) for the selected ball
    const scatterRow = document.getElementById('alexa-table-scatter');
    const scatterValEl = document.getElementById('alexa-scatter-value');
    const scatterVal = ball ? (ball.scatter ?? 0) : 0;
    if (scatterRow) scatterRow.classList.toggle('disabled', !ball);
    if (scatterSlider) {
        scatterSlider.disabled = !ball;
        scatterSlider.value = String(Math.round(scatterVal * 2) / 2);
        scatterSlider.title = ball
            ? `Scatter: ${scatterVal}`
            : 'Select a ball to change its scatter';
    }
    if (scatterValEl) scatterValEl.textContent = scatterVal.toFixed(1);
}

if (speedSlider) {
    speedSlider.addEventListener('input', () => {
        if (selectedBallIndex === null) return;
        const val = Math.round(parseFloat(speedSlider.value) * 10) / 10;
        window.updateAlexaBall?.(selectedBallIndex, { speed: val });
    });
}

if (dropSlider) {
    dropSlider.addEventListener('input', () => {
        if (selectedBallIndex === null) return;
        const val = Math.round(parseFloat(dropSlider.value) * 2) / 2;
        window.updateAlexaBall?.(selectedBallIndex, { drop: val });
    });
}

if (spinSlider) {
    spinSlider.addEventListener('input', () => {
        if (selectedBallIndex === null) return;
        const val = Math.round(parseFloat(spinSlider.value) * 2) / 2;
        window.updateAlexaBall?.(selectedBallIndex, { spin: val });
    });
}

if (heightSlider) {
    heightSlider.addEventListener('input', () => {
        if (selectedBallIndex === null) return;
        const val = Math.round(parseFloat(heightSlider.value));
        window.updateAlexaBall?.(selectedBallIndex, { height: val });
    });
}

if (bpmSlider) {
    bpmSlider.addEventListener('input', () => {
        if (selectedBallIndex === null) return;
        const val = Math.round(parseFloat(bpmSlider.value));
        window.updateAlexaBall?.(selectedBallIndex, { frequency: val });
    });
}

if (delaySlider) {
    delaySlider.addEventListener('input', () => {
        if (selectedBallIndex === null) return;
        const ms = Math.round(parseFloat(delaySlider.value) * 1000);
        window.updateAlexaBall?.(selectedBallIndex, { delay: ms });
    });
}

if (scatterSlider) {
    scatterSlider.addEventListener('input', () => {
        if (selectedBallIndex === null) return;
        const val = Math.round(parseFloat(scatterSlider.value) * 2) / 2;
        window.updateAlexaBall?.(selectedBallIndex, { scatter: val });
    });
}

window.setAlexaTableType = (type) => {
    if (selectedBallIndex === null) return;
    window.updateAlexaBall?.(selectedBallIndex, { type });
};
window.addEventListener('resize', positionAlexaSliders);

function collectLandings() {
    const drill = getAlexaDrill();
    const landings = [];
    let index = 0;
    const pushBall = (b) => {
        if (!b) return;
        index += 1;
        const spin = b.type === 'back' ? -(b.spin ?? 0) : (b.spin ?? 0);
        const l = window.getBallLanding?.(b.speed ?? 0, spin, b.height ?? 50, b.drop ?? 0);
        if (l) landings.push({ xCm: l.xCm, yCm: l.yCm, index, drop: b.drop ?? 0, speed: b.speed ?? 0, type: b.type ?? 'top', spin: b.spin ?? 0 });
    };
    for (const step of (drill?.steps || [])) {
        (step?.balls || []).forEach(pushBall);
    }
    return landings;
}

function drawAlexaTable() {
    if (!tableCanvas) return;
    const off = document.createElement('canvas');
    off.width = 600;    // a little extra length beyond the far end
    off.height = 400;   // a little extra room around the table
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    drawStaticRobot(off, true, theme, 20, 80);

    // Draw a landing marker for every ball in the Alexa drill.
    let landings = [];
    try {
        landings = collectLandings();
    } catch (e) {
        // Drill not ready yet — static table only.
    }
    drawLandingMarkers(off, landings, selectedBallIndex);
    alexaLandingPositions = getLandingMarkerPositions(landings);

    tableCanvas.width = off.height;   // 400 (rotated)
    tableCanvas.height = off.width;   // 600 (rotated)
    const ctx = tableCanvas.getContext('2d');
    ctx.save();
    ctx.translate(tableCanvas.width / 2, tableCanvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(off, -off.width / 2, -off.height / 2);
    ctx.restore();

    positionAlexaSliders();
    syncAlexaSliders();
}

window.drawAlexaTable = drawAlexaTable;

window.getSelectedAlexaBall = () => selectedBallIndex;

window.selectAlexaTableBall = (index) => {
    selectedBallIndex = index;
    window.renderAlexaBalls?.();
};

window.testAlexaBall = (index) => {
    const b = findAlexaBallByIndex(index);
    if (!b) return;
    const ball = new Ball(b);
    ball.ensureMeta();
    ball.clamp();
    const rpm = ball.getRPMs();
    sendSingleBall(rpm.top, rpm.bot, ball.height, ball.drop, ball.frequency, ball.reps)
        .then((ok) => showToast(ok ? 'Test ball fired' : 'Robot not connected'))
        .catch(() => showToast('Test ball failed'));
};

function findAlexaBallByIndex(index) {
    const drill = getAlexaDrill();
    let i = 0;
    for (const step of (drill?.steps || [])) {
        for (const b of (step?.balls || [])) {
            i++;
            if (i === index) return b;
        }
    }
    return null;
}

// ── Table ball interaction (select + drag) ───────────────────────────────
function tableToOff(dx, dy) {
    // After the 90° rotation, the offscreen height == tableCanvas.width.
    return { ox: dy, oy: tableCanvas.width - dx };
}

function clientToCanvas(e) {
    const rect = tableCanvas.getBoundingClientRect();
    // The canvas bitmap is rendered with object-fit: contain, anchored top-center
    // (.alexa-table-panel canvas), so map from the visible bitmap, not the full rect.
    const cw = tableCanvas.width;   // 400
    const ch = tableCanvas.height;  // 600
    const scale = Math.min(rect.width / cw, rect.height / ch);
    const dw = cw * scale;
    const dh = ch * scale;
    const bx = rect.left + (rect.width - dw) / 2;  // horizontally centred
    const by = rect.top;                            // anchored top
    return {
        dx: (e.clientX - bx) * (cw / dw),
        dy: (e.clientY - by) * (ch / dh),
    };
}

function hitTestMarker(e, padding = 12) {
    const { dx, dy } = clientToCanvas(e);
    const { ox, oy } = tableToOff(dx, dy);
    for (const m of alexaLandingPositions) {
        if (Math.hypot(ox - m.x, oy - m.y) <= (m.r + padding)) return m;
    }
    return null;
}

function attachAlexaTableInteractions() {
    if (!tableCanvas) return;
    tableCanvas.style.touchAction = 'none';

    tableCanvas.addEventListener('pointerdown', (e) => {
        const m = hitTestMarker(e);
        if (!m) {
            selectedBallIndex = null;
            tableDrag = null;
            window.renderAlexaBalls?.();
            return;
        }
        selectedBallIndex = m.index;
        tableDrag = {
            index: m.index,
            startClientX: e.clientX,
            startClientY: e.clientY,
            startDrop: m.drop ?? 0,
            startSpeed: m.speed ?? 0,
        };
        tableCanvas.setPointerCapture(e.pointerId);
        window.renderAlexaBalls?.();
        e.preventDefault();
    });

    tableCanvas.addEventListener('pointermove', (e) => {
        if (!tableDrag) return;
        e.preventDefault();
        const dxc = e.clientX - tableDrag.startClientX;
        const dyc = e.clientY - tableDrag.startClientY;
        const newDrop = Math.round(Math.max(-10, Math.min(10, tableDrag.startDrop + dxc / 6)) * 2) / 2;
        const newSpeed = Math.round(Math.max(0, Math.min(10, tableDrag.startSpeed + dyc / 40)) * 10) / 10;
        window.updateAlexaBall?.(tableDrag.index, { drop: newDrop, speed: newSpeed });
    });

    const endDrag = () => { tableDrag = null; };
    tableCanvas.addEventListener('pointerup', endDrag);
    tableCanvas.addEventListener('pointercancel', endDrag);
}

drawAlexaTable();
attachAlexaTableInteractions();

// Deselect the selected ball when clicking anywhere else on the page.
document.addEventListener('click', (e) => {
    if (selectedBallIndex === null) return;
    const t = e.target;
    if (t && t.closest && (t.closest('.alexa-ball-card') || t.closest('#alexa-table-canvas') || t.closest('#alexa-speed-slider') || t.closest('#alexa-spin-slider') || t.closest('#alexa-height-slider') || t.closest('#alexa-bpm-slider') || t.closest('#alexa-drop-slider') || t.closest('#alexa-delay-slider') || t.closest('#alexa-table-delay') || t.closest('#alexa-scatter-slider') || t.closest('#alexa-table-scatter') || t.closest('#alexa-table-rotation'))) return;
    selectedBallIndex = null;
    window.renderAlexaBalls?.();
});
