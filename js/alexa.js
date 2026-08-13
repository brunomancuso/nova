// js/alexa.js — voice control via a local whisper WebSocket server (server.py)
import { showToast } from './utils.js';

// The whisper server (server.py) runs on this machine by default.
// Use wss:// when the page itself is served over HTTPS.
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname || 'localhost'}:8765`;

let active = false;
let ws = null;
let audioCtx = null;
let micStream = null;
let processor = null;

const el = (id) => document.getElementById(id);

function setStatus(text) {
    const node = el('alexa-status');
    if (node) node.textContent = text;
}

function setCommand(text) {
    const node = el('alexa-command');
    if (node) node.textContent = text;
}

function showPanel() {
    document.body.classList.add('alexa-active');
    const btn = el('alexa-btn');
    if (btn) btn.classList.add('active');
}

function hidePanel() {
    document.body.classList.remove('alexa-active');
    const btn = el('alexa-btn');
    if (btn) btn.classList.remove('active');
}

// Stop all resources without hiding the panel (so status/errors stay visible).
function release() {
    active = false;
    if (processor) { try { processor.disconnect(); } catch (e) {} processor = null; }
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
}

function start() {
    if (active) return;
    setCommand('');
    showPanel();
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
                setStatus('SAY "ALEXA"');
                startAudio();
            };

            ws.onmessage = (ev) => {
                let msg;
                try { msg = JSON.parse(ev.data); } catch (e) { return; }

                if (msg.type === 'command' && msg.text) {
                    setCommand(msg.text);
                    setStatus('Command');
                } else if (msg.type === 'status' && msg.status === 'listening') {
                    setStatus('Listening ...');
                } else if (msg.type === 'status' && msg.status === 'idle') {
                    setStatus('SAY "ALEXA"');
                }
            };

            ws.onerror = () => {
                release();
                setStatus('Whisper server unreachable');
                showToast('Whisper server unreachable');
            };

            ws.onclose = () => {
                const wasActive = active;
                release();
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
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const f32 = e.inputBuffer.getChannelData(0);
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
    if (active) {
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
