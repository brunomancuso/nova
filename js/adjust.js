import { predictX, predictY, DEFAULT_KV, DEFAULT_KD, DEFAULT_KMS, DEFAULT_KLR } from './prediction.js';
import { Ball } from './model/index.js';
import { getRobotXcm, drawBall } from './robot.js';
import { showToast } from './utils.js';
import { sendSingleBall } from './runner.js';
import { bleState } from './bluetooth.js';

const CAL_STORAGE_KEY = 'nova_calibration';

function _loadCalibration() {
    try {
        const s = JSON.parse(localStorage.getItem(CAL_STORAGE_KEY));
        if (s && typeof s.kv === 'number') return s;
    } catch (_) {}
    return null;
}

// ── Adjust Physics modal ───────────────────────────────────────────────────
let _adjTemp = { kv: DEFAULT_KV, kd: DEFAULT_KD, kms: DEFAULT_KMS, klr: DEFAULT_KLR };

const _ADJ_STEP  = { kv: 0.0001,  kd: 0.001,   kms: 0.001,  klr: 0.0001 };
const _ADJ_DECS  = { kv: 6,       kd: 5,        kms: 5,      klr: 6     };

// Draw top-view ball using _adjTemp physics (not stored calibration)
window.drawAdjBall = (canvas, speed, spin, angle, drop = 0) => {
    const xFlight = predictX(angle, spin, speed, { kv: _adjTemp.kv, kd: _adjTemp.kd, kMS: _adjTemp.kms });
    const cannonM = getRobotXcm() + 40;
    const yCm     = predictY(drop, xFlight, _adjTemp.klr);
    drawBall(canvas, xFlight + cannonM, yCm);
};

// Compute xFlight using _adjTemp physics
window.getAdjXFlight = (speed, spin, angle) =>
    predictX(angle, spin, speed, { kv: _adjTemp.kv, kd: _adjTemp.kd, kMS: _adjTemp.kms });

function _adjDrawPreview() {
    window._redrawAdjPreviews?.();
}

function _adjRefresh() {
    for (const p of ['kv', 'kd', 'kms', 'klr']) {
        const slider = document.getElementById(`adj-${p}`);
        const valEl  = document.getElementById(`adj-${p}-val`);
        if (slider) slider.value = _adjTemp[p];
        if (valEl)  valEl.textContent = _adjTemp[p].toFixed(_ADJ_DECS[p]);
    }
}

window.openAdjustModal = () => {
    const stored = _loadCalibration();
    _adjTemp = {
        kv:  stored?.kv  ?? DEFAULT_KV,
        kd:  stored?.kd  ?? DEFAULT_KD,
        kms: stored?.kms ?? DEFAULT_KMS,
        klr: stored?.klr ?? DEFAULT_KLR,
    };
    // Default preview ball: speed=2, no spin, angle=50, drop=0
    window._adjBallData = [50, 50, 50, 0, 0, 1, 1, 2, 0, 'top'];
    document.getElementById('adjust-modal')?.classList.add('open');
    requestAnimationFrame(() => { _adjRefresh(); window.renderAdjTable?.(); });
};

window.closeAdjustModal = () => {
    document.getElementById('adjust-modal')?.classList.remove('open');
};

window.adjChanged = (param, value) => {
    _adjTemp[param] = parseFloat(value);
    const valEl = document.getElementById(`adj-${param}-val`);
    if (valEl) valEl.textContent = _adjTemp[param].toFixed(_ADJ_DECS[param]);
    _adjDrawPreview();
};

window.adjStep = (param, dir) => {
    const step = _ADJ_STEP[param];
    const slider = document.getElementById(`adj-${param}`);
    const min = parseFloat(slider?.min ?? 0);
    const max = parseFloat(slider?.max ?? 1);
    _adjTemp[param] = Math.min(max, Math.max(min,
        Math.round((_adjTemp[param] + dir * step) / step) * step
    ));
    _adjRefresh();
    _adjDrawPreview();
};

window.saveAdjust = () => {
    localStorage.setItem(CAL_STORAGE_KEY, JSON.stringify(_adjTemp));
    showToast('Physics saved');
    window.closeAdjustModal();
};

window.resetAdjust = () => {
    _adjTemp = { kv: DEFAULT_KV, kd: DEFAULT_KD, kms: DEFAULT_KMS, klr: DEFAULT_KLR };
    _adjRefresh();
    _adjDrawPreview();
    showToast('Reset to defaults');
};

window.testAdjust = async () => {
    if (!bleState.isConnected) { showToast('Device not connected'); return; }
    const ball = window._adjBallData;
    if (!ball) return;
    const b = ball instanceof Ball ? ball : Ball.fromArray(ball);
    if (!b) return;
    const speed = b.speed ?? 5;
    const spin  = b.spin ?? 0;
    const type  = b.type ?? 'top';
    const base  = 970 + 630.5 * speed;
    const delta = 342 * spin;
    const RPM_MIN = 970, RPM_MAX = 8000;
    const clamp  = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
    const top = type === 'top' ? clamp(base + delta, RPM_MIN, RPM_MAX) : clamp(base - delta, RPM_MIN, RPM_MAX);
    const bot = type === 'top' ? clamp(base - delta, RPM_MIN, RPM_MAX) : clamp(base + delta, RPM_MIN, RPM_MAX);
    const bh   = b.height ?? 50;
    const dp   = b.drop ?? 0;
    const freq = b.frequency ?? 0;
    await sendSingleBall(top, bot, bh, dp, freq, 1);
};
