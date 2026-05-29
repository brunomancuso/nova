/**
 * Ball landing prediction and calibration formulas.
 *
 * Calibration constants (all derivable from landing measurements alone):
 *   kv   — (km/h)/RPM, avg 0.00691 — relates Speed setting to ball speed
 *   kd   — drag constant (s/m)     — calibrate with spin=0 shots
 *   kMS  — combined Magnus-Spin constant (1/(m·rps²)) = kM × ks × 684
 *            kM and ks only ever appear as the product kM×ks×684 in g_eff,
 *            so they cannot be separated from landing data alone.
 *            Default: kM(0.10) × ks(0.00961) × 684 ≈ 0.657
 *
 * Robot inputs:
 *   speed  — Speed setting (0–10)
 *   spin   — Spin setting (negative = backspin, positive = topspin)
 *   angle  — throw angle parameter (≈ -50 to 100); angle_deg = angle × 0.4
 *   x      — measured landing position in cm from near end (for calibration)
 *
 * Calibration workflow (no speed/spin sensors needed):
 *   1. calibrateKvKd(shots)  — spin=0 shots at 2+ different Speed values
 *   2. calibrateKms(shots)   — spin≠0 shots with known kv/kd
 *   3. predictX(...)         — predict landing for any (speed, spin, angle)
 */

export const DEFAULT_KV  = 0.008978;         // (km/h) / RPM — fitted from test data
export const DEFAULT_KD  = 0.01254;          // s/m  — fitted from test data
export const DEFAULT_KMS = 0.14357;          // 1/m  — fitted from spin test shots
const DEBUG   = true;                        // log prediction details to console
const H0          = 0.24;             // m  — launch height above table
const HWIDTH      = 0.40;             // m  — robot depth (physical measurement)

// ─── private helpers ─────────────────────────────────────────────────────────

function _vel(speed, kv) {
    return (970 + 630.5 * speed) * kv / 3.6;   // m/s
}

function _theta(angle) {
    // zero at height=20, -20° at height=-50  →  k = 20/70 = 2/7
    return (angle - 20) * (2 / 7) * Math.PI / 180;   // radians
}

function _xProj(v, theta, gEff) {
    const vy    = v * Math.sin(theta);
    const vx    = v * Math.cos(theta);
    const tLand = (vy + Math.sqrt(vy * vy + 2 * gEff * H0)) / gEff;
    return vx * tLand;
}

// Golden-section minimiser for a unimodal f on [lo, hi]
function _goldenMin(f, lo, hi, tol = 1e-8) {
    const phi = (Math.sqrt(5) - 1) / 2;
    let a = lo, b = hi;
    let c = b - phi * (b - a);
    let d = a + phi * (b - a);
    while (Math.abs(b - a) > tol) {
        if (f(c) < f(d)) { b = d; } else { a = c; }
        c = b - phi * (b - a);
        d = a + phi * (b - a);
    }
    return (a + b) / 2;
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Calibrate kv and kd together from landing positions — no speed sensor needed.
 * Shoot at spin=0, at least 2 different Speed values (more = better accuracy).
 * The correct kv is the one where all shots agree on the same kd.
 *
 * @param {Array<{speed: number, angle: number, x: number}>} shots
 *   Each entry: speed setting, angle parameter, measured x in cm. All spin=0.
 * @returns {{ kv: number, kd: number }}
 */
export function calibrateKvKd(shots, robotXcm = 0) {
    const cannonM = robotXcm / 100 + HWIDTH;  // m from near end to cannon

    // For a candidate kv, compute per-shot kd (spin=0 → gEff = 9.81)
    const kdsFor = (kv) => shots.map(s => {
        const v     = _vel(s.speed, kv);
        const theta = _theta(s.angle);
        const xLand = s.x / 100 - cannonM;
        const xProj = _xProj(v, theta, 9.81);
        return -Math.log(xLand / xProj) / v;
    });

    // Minimise variance of kd values — all shots must agree on one kd
    const variance = (kv) => {
        const kds  = kdsFor(kv);
        const mean = kds.reduce((a, b) => a + b, 0) / kds.length;
        return kds.reduce((s, k) => s + (k - mean) ** 2, 0);
    };

    const kv = _goldenMin(variance, 0.003, 0.015);
    const kds = kdsFor(kv);
    const kd  = kds.reduce((a, b) => a + b, 0) / kds.length;
    return { kv, kd };
}

/**
 * Calibrate the combined Magnus-Spin constant kMS = kM × ks × 684.
 * Requires kv and kd already calibrated. Use spin ≠ 0.
 *
 * kMS is the only spin-related quantity needed for landing prediction —
 * kM and ks cannot be separated from landing data alone.
 *
 * @param {Array<{speed: number, spin: number, angle: number, x: number}>} shots
 * @param {number} kv   - Calibrated from calibrateKvKd
 * @param {number} kd   - Calibrated from calibrateKvKd
 * @returns {number} kMS
 */
export function calibrateKms(shots, kv, kd, robotXcm = 0) {
    const cannonM = robotXcm / 100 + HWIDTH;

    const kmsFor = (shot) => {
        const v     = _vel(shot.speed, kv);
        const theta = _theta(shot.angle);
        const xLand = shot.x / 100 - cannonM;

        // Undo drag to get true flight time
        const tLand = (xLand * Math.exp(kd * v)) / (v * Math.cos(theta));

        // Back-solve g_eff: g_eff = 2(vy·t + H0) / t²
        const vy   = v * Math.sin(theta);
        const gEff = 2 * (vy * tLand + H0) / (tLand * tLand);

        // kMS × Spin × v = g_eff - 9.81
        return (gEff - 9.81) / (shot.spin * v);
    };

    const vals = shots.map(kmsFor);
    return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * Predict ball flight distance from cannon — mirrors predict_dist() in predict.py.
 *
 * @param {number} height - angle setting; angle_deg = (height - 20) × 2/7
 * @param {number} spin   - spin setting (positive = topspin, negative = backspin)
 * @param {number} speed  - speed setting (0–10)
 * @param {object} [cal]  - optional calibration overrides: { kv, kd, kMS }
 * @returns {number} predicted dist in cm  (× 10 = dist mm, the 'dist' column in data.md)
 */
export function predictX(height, spin, speed, { kv = DEFAULT_KV, kd = DEFAULT_KD, kMS = DEFAULT_KMS } = {}) {
    const v     = (970 + 630.5 * speed) * kv / 3.6;         // m/s
    const theta = (height - 20) * (2 / 7) * Math.PI / 180;  // radians
    const vx    = v * Math.cos(theta);
    const vy    = v * Math.sin(theta);
    const gEff  = 9.81 + kMS * spin * v;                    // effective gravity
    const tLand = (vy + Math.sqrt(vy * vy + 2 * gEff * H0)) / gEff;
    const xLand = vx * tLand * Math.exp(-kd * v);           // m
    const result = xLand * 100;                              // cm  (× 10 = dist mm)

    if (DEBUG) console.log('[predictX]', { height, spin, speed, kv, kd, kMS, result_cm: result.toFixed(1) });

    return result;
}

/** KLR: radians of horizontal angle per left_right unit. Calibrated from lr=8 -> 72 cm at 238.3 cm. */
export const DEFAULT_KLR = 0.036677;

/**
 * Predict lateral (Y) landing offset from the cannon's straight-ahead axis.
 * @param {number} drop      - left_right setting (0 = straight)
 * @param {number} distXcm  - predicted X flight distance in cm (output of predictX)
 * @param {number} [klr]    - optional KLR override
 * @returns {number} y offset in cm
 */
export function predictY(drop, distXcm, klr = DEFAULT_KLR) {
    const angleRad = drop * klr;
    const result = distXcm * Math.tan(angleRad);
    if (DEBUG) console.log('[predictY]', { drop, distXcm, klr, result_cm: result.toFixed(1) });
    return result;
}


