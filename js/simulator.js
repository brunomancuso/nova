/**
 * simulator.js
 * Mock BLE driver for offline development/testing.
 *
 * Works by injecting a fake `writeChar` into the shared `bleState` object
 * exported by bluetooth.js. Since all modules hold a reference to the same
 * bleState object, mutating its properties here is immediately visible
 * everywhere — no changes to bluetooth.js, runner.js or editor.js required.
 */

import { bleState } from './bluetooth.js';
import { handleDone } from './runner.js';
import { startSession } from './state.js';

let ballCount = 0;
let _activeDrillName = '';

export function setActiveDrillName(name) { _activeDrillName = name; }

// ─── Public API ──────────────────────────────────────────────────────────────

export function connectSimulator() {
    simLog('▶  Simulator connect initiated');
    ballCount = 0;

    // Inject a fake writeChar so every sendPacket() call routes through us
    bleState.device = { gatt: { connected: true } };
    bleState.writeChar = {
        writeValue: (data) => {
            interceptPacket(data);
            return Promise.resolve();
        }
    };
    bleState.handshakeState = 'ready';
    bleState.isConnected    = true;

    startSession();
    simLog('✓  Connected (simulated)');
    document.dispatchEvent(new CustomEvent('connection-changed'));
}

export function disconnectSimulator() {
    bleState.isConnected    = false;
    bleState.device         = null;
    bleState.writeChar      = null;
    bleState.handshakeState = 'disconnected';

    simLog('■  Disconnected');
    document.dispatchEvent(new CustomEvent('connection-changed'));
}

// ─── Packet Interception ─────────────────────────────────────────────────────

function interceptPacket(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const len   = bytes.length;

    // ── Ball sequence packet: header 0x81, body = 7 header bytes + N×24 ──
    if (bytes[0] === 0x81 && len >= 31) {
        const numBalls = (len - 7) / 24;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let totalDelayMs = 0;

        for (let i = 0; i < numBalls; i++) {
            const off  = 7 + i * 24;
            const us   = view.getUint32(off,      true);
            const ls   = view.getUint32(off +  4, true);
            const bh_f = view.getFloat32(off +  8, true);
            const dp_f = view.getFloat32(off + 12, true);
            const fr_f = view.getFloat32(off + 16, true);
            const reps = view.getUint32(off + 20, true);

            const ht   = Math.round((bh_f + 20) / 50 * 150 - 50);
            const dp   = Math.round(((dp_f + 22) / 44 * 20 - 10) * 10) / 10;
            const bpm  = Math.round((fr_f - 0.5) * 60 + 30);
            const spin = us >= ls ? 'TOP' : 'BACK';
            const spd  = approxSpeed(us, ls);

            ballCount++;
            simLog(
                `${_activeDrillName}  →  Ball ${i + 1}` +
                `  [${spin}]  spd≈${spd}  ht=${ht}  dp=${dp}  bpm=${bpm}  reps=${reps}`
            );
            totalDelayMs += reps * (60000 / bpm);
        }

        // Simulate delivery time (capped at 4 s so tests stay snappy)
        const delay = Math.min(totalDelayMs, 4000);
        simLog(`  ⏱  ~${(delay / 1000).toFixed(1)} s delivery…`);

        setTimeout(() => {
            simLog('  ✓  Done  →  handleDone()');
            handleDone();
        }, delay);

    // ── Stop / Ready control packet ──
    } else if (bytes[0] === 0x80) {
        const sub = bytes.length > 3 ? bytes[3] : 0;
        simLog(`[CTRL]  0x80  sub=${sub}  (${sub === 1 ? 'STOP/READY' : 'unknown'})`);

    // ── Any other control / handshake packet ──
    } else {
        const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join(' ');
        simLog(`[TX ${String(len).padStart(2)}B]  ${hex}`);
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Rough reverse of: base = 970 + 630.5 × speed */
function approxSpeed(us, ls) {
    const avg = (us + ls) / 2;
    const spd = (avg - 970) / 630.5;
    return Math.max(0, spd).toFixed(1);
}

// ─── Simulator Log ───────────────────────────────────────────────────────────

export function simLog(msg) {
    const panel = document.getElementById('sim-log');
    if (!panel) return;

    const ts = new Date().toLocaleTimeString('en-US', {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const line = document.createElement('div');
    line.className   = 'sim-line';
    line.textContent = `${ts}  ${msg}`;
    panel.appendChild(line);

    // Cap log at 200 lines to avoid unbounded memory growth
    while (panel.children.length > 200) panel.removeChild(panel.firstChild);

    panel.scrollTop = panel.scrollHeight;
}
