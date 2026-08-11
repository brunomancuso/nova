// Renders the compact table-view HTML for one ball option:
// canvas + sliders for Speed, BPM, Spin, Height + drop display.
// Reps is intentionally excluded — it lives in the group header (single variant)
// or above the canvas (multi-variant), both handled in editor.js.

// ── Parabolic trajectory helper ───────────────────────────────────────────────────
// Given start (x0,z0), landing x, and launch angle, returns {x,z} cm points.
// Simple projectile (no drag, no Magnus). Units: cm, cm/s^2.
function _parabolaPoints(x0, z0, xLand, theta) {
    const g = 981;  // cm/s^2
    const dx = xLand - x0;
    if (dx <= 0) return [];
    const cosT  = Math.cos(theta);
    const cos2T = cosT * cosT;
    const denom = z0 + dx * Math.tan(theta);
    if (denom <= 0) return [];
    const v = Math.sqrt(g * dx * dx / (2 * cos2T * denom));
    const tLand = dx / (v * cosT);
    const pts = [];
    const N = 60;
    for (let i = 0; i <= N; i++) {
        const t = tLand * i / N;
        const x = x0 + v * cosT * t;
        const z = z0 + v * Math.sin(theta) * t - 0.5 * g * t * t;
        pts.push({ x, z: Math.max(0, z) });
    }
    return pts;
}

// ── Side-view drawing ─────────────────────────────────────────────────────────
// Draws a side-profile of the table. xFlight = predictX result (cm), thetaRad = launch angle.
export function drawSideView(canvas, xFlight = 0, thetaRad = 0) {
    const robotXcm = window.getRobotXcm?.() ?? 0;
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    // Same margins as top-view compact: tX=10, tW=W-20
    const tX    = 10;
    const tW    = W - 20;          // 320 for W=340 — matches top-view table width exactly
    const scale = tW / 274;        // px/cm

    const tableY    = H - 14;
    const tableH    = 5;
    const netX      = tX + 137 * scale;          // 274/2 cm centre
    const netH      = Math.round(16 * scale) - 3;    // 16 cm net height
    const robDepth  = Math.round(40 * scale);    // 40 cm robot depth
    const robHeight = Math.round(24 * scale);    // 24 cm robot height
    const robX      = tX + robotXcm * scale;
    const robY      = tableY - robHeight;

    // Table surface — blue fill + white border, same as top-view
    ctx.fillStyle = '#1565C0';
    ctx.fillRect(tX, tableY, tW, tableH);
    ctx.lineWidth = 2.5;
    // Top border: white
    ctx.beginPath();
    ctx.moveTo(tX,      tableY);
    ctx.lineTo(tX + tW, tableY);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    // Left border: table blue
    ctx.beginPath();
    ctx.moveTo(tX, tableY);
    ctx.lineTo(tX, tableY + tableH);
    ctx.strokeStyle = '#1565C0';
    ctx.stroke();
    // Bottom border: table blue
    ctx.beginPath();
    ctx.moveTo(tX,      tableY + tableH);
    ctx.lineTo(tX + tW, tableY + tableH);
    ctx.strokeStyle = '#1565C0';
    ctx.stroke();
    // Right border: table blue
    ctx.beginPath();
    ctx.moveTo(tX + tW, tableY);
    ctx.lineTo(tX + tW, tableY + tableH);
    ctx.strokeStyle = '#1565C0';
    ctx.stroke();

    // Net shadow (matches top-view)
    ctx.beginPath();
    ctx.moveTo(netX, tableY - netH);
    ctx.lineTo(netX, tableY + tableH + 1);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 6;
    ctx.stroke();
    // Net line
    ctx.beginPath();
    ctx.moveTo(netX, tableY - netH);
    ctx.lineTo(netX, tableY + tableH + 1);
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Net posts
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(netX - 2.5, tableY - netH - 4, 5, 5);
    ctx.fillRect(netX - 2.5, tableY + tableH, 5, 5);

    // Cannon drawn FIRST so robot body covers its base (appears to emerge from robot)
    const cannonLen = 14;
    const cannonW   = Math.max(5, robHeight * 0.32);
    const angleUp   = -18 * Math.PI / 180;
    const cStartX   = robX + robDepth - 2;
    const cStartY   = robY + robHeight * 0.18;
    ctx.save();
    ctx.translate(cStartX, cStartY);
    ctx.rotate(angleUp);
    ctx.fillStyle   = '#2d3748';
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth   = 1;
    ctx.fillRect(0, -cannonW / 2, cannonLen, cannonW);
    ctx.strokeRect(0, -cannonW / 2, cannonLen, cannonW);
    ctx.restore();

    // Robot body drawn ON TOP of cannon base
    const grad = ctx.createLinearGradient(robX, robY, robX + robDepth, robY + robHeight);
    grad.addColorStop(0, '#ff7a5c');
    grad.addColorStop(1, '#e84d28');
    ctx.fillStyle = grad;
    ctx.fillRect(robX, robY, robDepth, robHeight);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(robX, robY, robDepth, robHeight);

    // Ball trajectory (parabolic arc landing at robotXcm+40+xFlight)
    if (xFlight > 0) {
        const x0_cm    = robotXcm + 40;          // cannon exit, cm from near end
        const z0_cm    = 24 * 0.82;              // ~19.7 cm cannon height
        const xLand_cm = x0_cm + xFlight;        // absolute landing cm from near end
        const pts = _parabolaPoints(x0_cm, z0_cm, xLand_cm, thetaRad);
        if (pts.length > 1) {
            ctx.save();
            ctx.beginPath();
            ctx.setLineDash([4, 3]);
            ctx.strokeStyle = 'rgba(255,255,255,0.65)';
            ctx.lineWidth = 1.5;
            ctx.moveTo(tX + pts[0].x * scale, tableY - pts[0].z * scale);
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(tX + pts[i].x * scale, tableY - pts[i].z * scale);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            // Landing dot
            ctx.beginPath();
            ctx.arc(tX + xLand_cm * scale, tableY, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.restore();
        }
    }
}

export function renderBallTable(si, oi, ballParams, bpmValue, spinSliderVal, spinColor, heightColor) {
    const canvasId   = `editor-robot-canvas-${si}-${oi}`;
    const sideId     = `side-view-canvas-${si}-${oi}`;
    // Support both Ball instances and legacy arrays
    const drop = ballParams instanceof Object && 'drop' in ballParams ? ballParams.drop : (ballParams[3] ?? 0);
    const speed = ballParams instanceof Object && 'speed' in ballParams ? ballParams.speed : (ballParams[7] ?? 0);
    const height = ballParams instanceof Object && 'height' in ballParams ? ballParams.height : (ballParams[2] ?? 0);
    const lockHtml = window.getLockIconHtml?.() ?? '';
    return `
    <div class="edit-mode-canvas-row">
        <div class="edit-mode-canvas-col">
            <canvas id="${sideId}" width="340" height="75" style="width:100%; height:auto; aspect-ratio:340/75; border-radius:6px; display:block; margin-bottom:4px;"></canvas>
            <div style="position:relative;">
                <canvas id="${canvasId}" width="340" height="218" style="width:100%; height:auto; aspect-ratio:340/218; border-radius:8px; display:block;"></canvas>
            </div>
        </div>
        <div class="bpm-slider-col">
            <div style="height:19px; margin-bottom:2px;"></div>
            <button class="slider-step-btn" onclick="window.handleSliderStep('rng-speed-${si}-${oi}',1)">▲</button>
            <input type="range" id="rng-speed-${si}-${oi}" class="bpm-slider-v"
                   min="0" max="10" step="0.1" value="${speed}"
                   oninput="window.handleEditModeSpeed('${si}', ${oi}, this.value)">
            <button class="slider-step-btn" onclick="window.handleSliderStep('rng-speed-${si}-${oi}',-1)">▼</button>
            <span class="bpm-slider-label">Speed</span>
            <span class="bpm-slider-val" id="speed-val-${si}-${oi}">${(+speed).toFixed(2)}</span>
        </div>
        <div class="bpm-slider-col">
            <div style="height:19px; margin-bottom:2px;"></div>
            <button class="slider-step-btn" onclick="window.handleSliderStep('rng-bpm-${si}-${oi}',1)">▲</button>
            <input type="range" id="rng-bpm-${si}-${oi}" class="bpm-slider-v"
                   min="30" max="120" value="${bpmValue}"
                   oninput="window.handleEditModeBpm('${si}', ${oi}, this.value)">
            <button class="slider-step-btn" onclick="window.handleSliderStep('rng-bpm-${si}-${oi}',-1)">▼</button>
            <span class="bpm-slider-label">BPM</span>
            <span class="bpm-slider-val" id="bpm-val-${si}-${oi}">${bpmValue}</span>
        </div>
        <div class="bpm-slider-col">
            ${lockHtml}
            <button class="slider-step-btn" onclick="window.handleSliderStep('rng-spin-${si}-${oi}',1)">▲</button>
            <input type="range" id="rng-spin-${si}-${oi}" class="bpm-slider-v"
                   min="-10" max="10" step="0.1" value="${spinSliderVal}"
                   style="accent-color:${spinColor}"
                   oninput="window.handleEditModeSpin('${si}', ${oi}, this.value, this)">
            <button class="slider-step-btn" onclick="window.handleSliderStep('rng-spin-${si}-${oi}',-1)">▼</button>
            <span class="bpm-slider-label">Spin</span>
            <span class="bpm-slider-val" id="spin-val-${si}-${oi}" style="color:${spinColor}">${spinSliderVal > 0 ? '+' : ''}${spinSliderVal}</span>
        </div>
        <div class="bpm-slider-col">
            <div style="height:19px; margin-bottom:2px;"></div>
            <button class="slider-step-btn" onclick="window.handleSliderStep('rng-height-${si}-${oi}',1)">▲</button>
            <input type="range" id="rng-height-${si}-${oi}" class="bpm-slider-v"
                   min="-50" max="100" step="1" value="${height}"
                   style="accent-color:${heightColor}"
                   oninput="window.handleEditModeHeight('${si}', ${oi}, this.value, this)">
            <button class="slider-step-btn" onclick="window.handleSliderStep('rng-height-${si}-${oi}',-1)">▼</button>
            <span class="bpm-slider-label">Height</span>
            <span class="bpm-slider-val" id="height-val-${si}-${oi}" style="color:${heightColor}">${height}</span>
        </div>
    </div>`;
}
