import { calibrateKvKd, calibrateKms, predictX, predictY, DEFAULT_KV, DEFAULT_KD, DEFAULT_KMS, DEFAULT_KLR } from './prediction.js';
import { drawBall, getRobotXcm } from './robot.js';
import { sendSingleBall } from './runner.js';
import { bleState } from './bluetooth.js';
import { showToast } from './utils.js';

// ── Constants ─────────────────────────────────────────────────────────────────
export const CAL_STORAGE_KEY = 'nova_calibration';

// Target landing positions (cm from near end): 6/8, 7/8, far end of table
const CAL_BALL_X = [274 * 6 / 8 - 2, 274 * 7 / 8 - 2, 274 - 2];
const CAL_DP     = 0;
const CAL_FREQ   = 0;
const CAL_REPS   = 1;

// ── State ─────────────────────────────────────────────────────────────────────
// Phase 1 → spin=0,  3 balls → calibrate kv+kd
// Phase 2 → spin=+5, 3 balls → calibrate kMS (topspin)
// Phase 3 → spin=-5, 3 balls → calibrate kMS (backspin) → average → done
let _calPhase        = 1;
let _calBalls        = [{ speed: 2 }, { speed: 5 }, { speed: 8 }];
let _calSelectedBall = 0;
let _calPhase1Shots  = [];
let _calPhase2Shots  = [];
let _calPhase3Shots  = [];
let _calResult       = { kv: null, kd: null, kms: null };
let _calHeight       = 50;
let _calSpin2        = 5;
let _calSpin3        = -5;

// ── Init (stale-seed check) ───────────────────────────────────────────────────
export function initCalibration() {
    const _storedCal = localStorage.getItem(CAL_STORAGE_KEY);
    const _STALE = [
        { kv: 0.00691, kd: 0.19  },
        { kv: 0.00245, kd: 0.08  },
        { kv: 0.00245, kd: 0.125 },
        { kv: 0.00691, kd: 0.125 },
    ];
    const _isStale = !_storedCal || (() => {
        try {
            const s = JSON.parse(_storedCal);
            return _STALE.some(o => s.kv === o.kv && s.kd === o.kd);
        } catch { return false; }
    })();
    if (_isStale) {
        localStorage.setItem(CAL_STORAGE_KEY, JSON.stringify({
            kv:  DEFAULT_KV,
            kd:  DEFAULT_KD,
            kms: DEFAULT_KMS,
        }));
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────
function _loadCalibration() {
    try {
        const s = JSON.parse(localStorage.getItem(CAL_STORAGE_KEY));
        if (s && typeof s.kv === 'number') return s;
    } catch (_) {}
    return null;
}

// Invert predictX: find speed that lands at targetFromCannonCm given angle+spin+cal.
// predictX is monotonically increasing with speed, so bisection converges quickly.
function _estimateSpeed(targetFromCannonCm, angle, spin, cal) {
    let lo = 0, hi = 10;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (predictX(angle, spin, mid, cal) < targetFromCannonCm) lo = mid;
        else hi = mid;
    }
    return parseFloat(((lo + hi) / 2).toFixed(1));
}

// Recompute all 3 ball speeds to hit their target landing positions.
// Uses freshly calibrated kv/kd if available (phases 2+), else stored/default.
function _recomputeBallSpeeds(spin) {
    const stored = _loadCalibration();
    const cal = {
        kv:  _calResult.kv  ?? stored?.kv  ?? DEFAULT_KV,
        kd:  _calResult.kd  ?? stored?.kd  ?? DEFAULT_KD,
        kMS: _calResult.kms ?? stored?.kms ?? DEFAULT_KMS,
    };
    const cannonCm = getRobotXcm() + 40;
    for (let i = 0; i < 3; i++) {
        _calBalls[i].speed = _estimateSpeed(CAL_BALL_X[i] - cannonCm, _calHeight, spin, cal);
    }
}

function _drawCalCanvas() {
    const canvas = document.getElementById('calibration-table-canvas');
    if (!canvas) return;
    drawBall(canvas, CAL_BALL_X[_calSelectedBall]);
}

function _refreshResultsPanel() {
    const panel   = document.getElementById('cal-results-panel');
    const saveBtn = document.getElementById('cal-save-btn');
    if (!panel) return;

    const stored = _loadCalibration();
    const r      = _calResult;

    // cell(formattedString, rawValue, referenceValue)
    // ref=null → no colour (Stored column); compare raw nums for colour
    const cell = (fmt, raw, ref) => {
        if (raw == null) return `<td class="cal-t-empty">—</td>`;
        const cls = ref == null ? '' : raw > ref ? ' cal-t-up' : raw < ref ? ' cal-t-dn' : '';
        return `<td class="cal-t-val${cls}">${fmt}</td>`;
    };

    const f5  = v => v != null ? v.toFixed(5) : null;
    const f4  = v => v != null ? v.toFixed(4) : null;

    panel.innerHTML = `
    <table class="cal-results-table">
      <thead><tr>
        <th class="cal-t-hdr"></th>
        <th class="cal-t-hdr">Stored</th>
        <th class="cal-t-hdr">Ph 1</th>
        <th class="cal-t-hdr">Ph 2</th>
        <th class="cal-t-hdr">Ph 3</th>
      </tr></thead>
      <tbody>
        <tr>
          <td class="cal-t-lbl">kv</td>
          ${cell(f5(stored?.kv),  stored?.kv,  null)}
          ${cell(f5(r.kv),        r.kv,        stored?.kv)}
          <td class="cal-t-empty">—</td>
          <td class="cal-t-empty">—</td>
        </tr>
        <tr>
          <td class="cal-t-lbl">kd</td>
          ${cell(f4(stored?.kd),  stored?.kd,  null)}
          ${cell(f4(r.kd),        r.kd,        stored?.kd)}
          <td class="cal-t-empty">—</td>
          <td class="cal-t-empty">—</td>
        </tr>
        <tr>
          <td class="cal-t-lbl">kMS</td>
          ${cell(f4(stored?.kms), stored?.kms, null)}
          <td class="cal-t-empty">—</td>
          ${cell(f4(r.kms2),      r.kms2,      stored?.kms)}
          ${cell(f4(r.kms),       r.kms,       stored?.kms)}
        </tr>
      </tbody>
    </table>`;

    const done = r.kms !== null;
    if (saveBtn) saveBtn.style.display = done ? '' : 'none';
    const sendBtn = document.querySelector('#calibration-modal .btn-modal[onclick="window.sendCalibrationBall()"]');
    const nextBtn = document.querySelector('#calibration-modal .btn-modal[onclick="window.nextCalibrationBall()"]');
    if (sendBtn) sendBtn.style.display = done ? 'none' : '';
    if (nextBtn) nextBtn.style.display = done ? 'none' : '';
}

function _refreshCalUI() {
    const slider     = document.getElementById('cal-speed-slider');
    const valEl      = document.getElementById('cal-speed-val');
    const phaseLabel = document.getElementById('cal-phase-label');
    const speed      = _calBalls[_calSelectedBall].speed;

    if (slider)     slider.value      = speed;
    if (valEl)      valEl.textContent = speed;
    if (phaseLabel) phaseLabel.textContent =
        _calPhase === 1 ? 'Phase 1 · Spin 0' :
        _calPhase === 2 ? 'Phase 2 · Spin +5' :
                          'Phase 3 · Spin -5';

    for (let i = 0; i < 3; i++) {
        document.getElementById(`cal-ball-${i}`)?.classList.toggle('selected', i === _calSelectedBall);
    }
    _drawCalCanvas();
    _refreshResultsPanel();
}

// ── Window handlers ───────────────────────────────────────────────────────────
window.openCalibrationModal = () => {
    _calPhase        = 1;
    _calBalls        = [{ speed: 2 }, { speed: 5 }, { speed: 8 }];
    _calSelectedBall = 0;
    _calPhase1Shots  = [];
    _calPhase2Shots  = [];
    _calPhase3Shots  = [];
    _calResult       = { kv: null, kd: null, kms: null };
    _calHeight = 50; _calSpin2 = 5; _calSpin3 = -5;
    const hi = document.getElementById('cal-height-input'); if (hi) hi.value = 50;
    const s2 = document.getElementById('cal-spin2-input');  if (s2) s2.value = 5;
    const s3 = document.getElementById('cal-spin3-input');  if (s3) s3.value = -5;
    _recomputeBallSpeeds(0);  // phase 1: spin=0
    document.getElementById('calibration-modal')?.classList.add('open');
    requestAnimationFrame(_refreshCalUI);
};

window.closeCalibrationModal = () => {
    document.getElementById('calibration-modal')?.classList.remove('open');
};

window.calSelectBall = (i) => {
    _calSelectedBall = i;
    _refreshCalUI();
};

window.calSpeedChanged = (val) => {
    _calBalls[_calSelectedBall].speed = parseFloat(val);
    document.getElementById('cal-speed-val').textContent = val;
    _drawCalCanvas();
};

window.calSpeedStep = (delta) => {
    const newSpeed = parseFloat(Math.min(10, Math.max(0, _calBalls[_calSelectedBall].speed + delta)).toFixed(1));
    _calBalls[_calSelectedBall].speed = newSpeed;
    _refreshCalUI();
};

window.calHeightChanged = (val) => {
    const v = parseFloat(val);
    if (!isNaN(v)) {
        _calHeight = v;
        const spin = _calPhase === 1 ? 0 : _calPhase === 2 ? _calSpin2 : _calSpin3;
        _recomputeBallSpeeds(spin);
        _refreshCalUI();
    }
};
window.calSpin2Changed = (val) => {
    const v = parseFloat(val);
    if (!isNaN(v)) {
        _calSpin2 = v;
        if (_calPhase === 2) { _recomputeBallSpeeds(_calSpin2); _refreshCalUI(); }
    }
};
window.calSpin3Changed = (val) => {
    const v = parseFloat(val);
    if (!isNaN(v)) {
        _calSpin3 = v;
        if (_calPhase === 3) { _recomputeBallSpeeds(_calSpin3); _refreshCalUI(); }
    }
};

window.nextCalibrationBall = () => {
    const shot = {
        speed:  _calBalls[_calSelectedBall].speed,
        spin:   _calPhase === 1 ? 0 : _calPhase === 2 ? _calSpin2 : _calSpin3,
        angle:  _calHeight,
        x:      CAL_BALL_X[_calSelectedBall],
    };
    if (_calPhase === 1)      _calPhase1Shots[_calSelectedBall] = shot;
    else if (_calPhase === 2) _calPhase2Shots[_calSelectedBall] = shot;
    else                      _calPhase3Shots[_calSelectedBall] = shot;

    if (_calSelectedBall < 2) {
        _calSelectedBall++;
        _refreshCalUI();
        return;
    }

    if (_calPhase === 1) {
        const { kv, kd } = calibrateKvKd(_calPhase1Shots, getRobotXcm());
        _calResult = { kv, kd, kms: null, kms2: null };
        _calPhase        = 2;
        _calBalls        = [{ speed: 0 }, { speed: 0 }, { speed: 0 }];
        _recomputeBallSpeeds(_calSpin2);
        _calSelectedBall = 0;
        _calPhase2Shots  = [];
    } else if (_calPhase === 2) {
        _calResult.kms2  = calibrateKms(_calPhase2Shots, _calResult.kv, _calResult.kd, getRobotXcm());
        _calPhase        = 3;
        _calBalls        = [{ speed: 0 }, { speed: 0 }, { speed: 0 }];
        _recomputeBallSpeeds(_calSpin3);
        _calSelectedBall = 0;
        _calPhase3Shots  = [];
    } else {
        const kms3 = calibrateKms(_calPhase3Shots, _calResult.kv, _calResult.kd, getRobotXcm());
        _calResult.kms   = (_calResult.kms2 + kms3) / 2;
        _calSelectedBall = 0;
    }
    _refreshCalUI();
};

window.sendCalibrationBall = async () => {
    if (!bleState.isConnected) { showToast('Device not connected'); return; }
    const spd       = _calBalls[_calSelectedBall].speed;
    const baseRpm   = Math.round(970 + 630.5 * spd);
    const spinVal   = _calPhase === 2 ? _calSpin2 : (_calPhase === 3 ? _calSpin3 : 0);
    const spinDelta = Math.round(342 * spinVal);
    const ok = await sendSingleBall(baseRpm + spinDelta, baseRpm - spinDelta, _calHeight, CAL_DP, CAL_FREQ, CAL_REPS);
    if (ok) showToast('Calibration ball sent');
};

window.saveCalibrationResult = () => {
    localStorage.setItem(CAL_STORAGE_KEY, JSON.stringify(_calResult));
    showToast('Calibration saved — you can start over or close');
    // Reset state so the user can run another round without closing
    _calPhase        = 1;
    _calBalls        = [{ speed: 0 }, { speed: 0 }, { speed: 0 }];
    _calSelectedBall = 0;
    _calPhase1Shots  = [];
    _calPhase2Shots  = [];
    _calPhase3Shots  = [];
    _calResult       = { kv: null, kd: null, kms: null };
    _calHeight = 50; _calSpin2 = 5; _calSpin3 = -5;
    const hi = document.getElementById('cal-height-input'); if (hi) hi.value = 50;
    const s2 = document.getElementById('cal-spin2-input');  if (s2) s2.value = 5;
    const s3 = document.getElementById('cal-spin3-input');  if (s3) s3.value = -5;
    _recomputeBallSpeeds(0);
    _refreshCalUI();
};

window.resetCalibration = () => {
    localStorage.setItem(CAL_STORAGE_KEY, JSON.stringify({
        kv:  DEFAULT_KV,
        kd:  DEFAULT_KD,
        kms: DEFAULT_KMS,
    }));
    _calResult = { kv: null, kd: null, kms: null };
    showToast('Calibration reset to defaults');
    window.closeCalibrationModal();
};

// ── Editor ball prediction (uses stored calibration) ─────────────────────────
window.drawEditorBall = (canvas, speed, spin, angle, drop = 0) => {
    const stored = _loadCalibration();
    const kv  = stored?.kv  ?? DEFAULT_KV;
    const kd  = stored?.kd  ?? DEFAULT_KD;
    const kMS = stored?.kms ?? DEFAULT_KMS;
    const klr = stored?.klr ?? DEFAULT_KLR;
    const xFlight = predictX(angle, spin, speed, { kv, kd, kMS });
    const cannonM = getRobotXcm() + 40;
    const yCm = predictY(drop, xFlight, klr);
    drawBall(canvas, xFlight + cannonM, yCm);
};

window.getEditorXFlight = (speed, spin, angle) => {
    const stored = _loadCalibration();
    const kv  = stored?.kv  ?? DEFAULT_KV;
    const kd  = stored?.kd  ?? DEFAULT_KD;
    const kMS = stored?.kms ?? DEFAULT_KMS;
    return predictX(angle, spin, speed, { kv, kd, kMS });
};
