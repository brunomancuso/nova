// js/robot.js — Bird-view robot position editor

import { bleState } from './bluetooth.js';

const STORAGE_KEY = 'nova_robot_pos';

// Normalised position in [0,1]: x = along table length, y = across table width
// x=0 → near end (left), x=1 → far end (right)
// y=0 → top rail,        y=1 → bottom rail
let _savedPos  = _loadPos();   // last committed (localStorage) state
let robotPos   = { ..._savedPos }; // working copy while modal is open

// Ball position per canvas — set by drawBall(), read by editor drag hit-test
const _ballCanvasMap = new WeakMap();  // canvas → { x, y, r }

export function getLastBallCanvas(canvas) { return canvas ? _ballCanvasMap.get(canvas) : null; }

let _isDragging = false;
let _layout = { tX: 0, tY: 0, tW: 1, tH: 1 };

// Robot size as fraction of table dimensions (depth along length × width across width)
const ROB_W = 40 / 274;    // ≈ 0.146  — 40 cm robot depth  / 274 cm table length
const ROB_H = 16 / 152.5;  // ≈ 0.105  — 16 cm robot width  / 152.5 cm table width

function _loadPos() {
    try {
        const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (s && typeof s.x === 'number' && typeof s.y === 'number') return s;
    } catch (_) {}
    return { x: 0, y: 0 }; // left edge at near end, centred laterally
}

function _savePos() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(robotPos));
    _savedPos = { ...robotPos };
}

export function saveRobotPos() {
    _savePos();
    if (window.simLog) {
        const x = (robotPos.x * 274).toFixed(1);
        const y = (robotPos.y * 152.5).toFixed(1);
        window.simLog(`[Robot] New Position: (${x}, ${y})`);
    }
    closeRobotPosModal();
}

// Apply current working position without closing the modal
export function applyRobotPos() {
    _savePos();
    if (window.simLog) {
        const x = (robotPos.x * 274).toFixed(1);
        const y = (robotPos.y * 152.5).toFixed(1);
        window.simLog(`[Robot] Test Position: (${x}, ${y})`);
    }
    if (window.showToast) window.showToast('Position applied');
}

export function cancelRobotPos() {
    robotPos = { ..._savedPos }; // revert working copy
    closeRobotPosModal();
}

export function getRobotPosition() {
    return { ...robotPos };
}

// Returns the robot's X position in cm (0 = near end, 274 = far end).
export function getRobotXcm() {
    return _savedPos.x * 274;
}

// Reset the working position to (0, 0) and redraw — for use while modal is open.
export function resetRobotPos() {
    robotPos = { x: 0, y: 0 };
    const canvas = document.getElementById('robot-table-canvas');
    if (canvas) _draw(canvas, false);
}

// Draw the table+robot onto any canvas element without attaching drag events
// compact=true skips the outside-zone boxes
export function drawStaticRobot(canvas, compact = false, theme = 'light') {
    if (!canvas) return;
    _draw(canvas, compact, theme);
}

// Draw robot at a fixed cm position (does not affect saved robotPos)
// xCm = left-edge position in cm from near end; yCm = offset from table centre in cm (negative = top)
export function drawAtCm(canvas, xCm, yCm, compact = false) {
    if (!canvas) return;
    const saved = { ...robotPos };
    robotPos = { x: xCm / 274, y: yCm / 152.5 };
    _draw(canvas, compact);
    robotPos = saved;
}

// Draw table (compact) + a ball at xCm from near end, with a dashed
// trajectory line from the cannon tip to the ball.
export function drawBall(canvas, xCm, yCm = 0, noLine = false) {
    if (!canvas) return;
    _draw(canvas, true);
    const ctx = canvas.getContext('2d');
    const { tX, tY, tW, tH } = _layout;

    // Ball canvas position
    const ballX = tX + (xCm / 274) * tW;
    const cannonX = tX + (_savedPos.x + ROB_W) * tW + 9;       // right edge of robot body
    const cannonY = tY + (0.5 + _savedPos.y) * tH;              // vertical centre
    const ballY   = cannonY - (yCm / 152.5) * tH;               // lateral offset (up = positive)
    const ballR = Math.max(3.5, (3 / 274) * tW);   // ~3 cm radius
    _ballCanvasMap.set(canvas, { x: ballX, y: ballY, r: ballR });

    ctx.save();
    if (!noLine) {
        // Dashed trajectory line
        ctx.beginPath();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.5;
        ctx.moveTo(cannonX, cannonY);
        ctx.lineTo(ballX, ballY);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Ball circle
    ctx.beginPath();
    ctx.arc(ballX, ballY, ballR, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
}

// Draw landing markers (no dashed line) on an already-drawn compact table.
// `landings` is an array of { xCm, yCm } in table coordinates.
export function drawLandingMarkers(canvas, landings) {
    if (!canvas || !landings || !landings.length) return;
    const ctx = canvas.getContext('2d');
    const { tX, tY, tW, tH } = _layout;
    const cannonY = tY + (0.5 + _savedPos.y) * tH;
    const ballR = Math.max(4, (3 / 274) * tW) * 1.5;
    for (const l of landings) {
        const ballX = tX + (l.xCm / 274) * tW;
        const ballY = cannonY - (l.yCm / 152.5) * tH;
        ctx.beginPath();
        ctx.arc(ballX, ballY, ballR, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();
        if (l.index != null) {
            ctx.fillStyle = '#1565C0';
            ctx.font = `bold ${Math.max(8, Math.round(ballR * 1.2))}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(l.index), ballX, ballY + 0.5);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }
    }
}

export function openRobotPosModal() {
    const modal = document.getElementById('robot-pos-modal');
    if (!modal) return;
    robotPos = { ..._savedPos }; // start with last saved state
    modal.classList.add('open');
    requestAnimationFrame(() => _initCanvas());
}

export function closeRobotPosModal() {
    document.getElementById('robot-pos-modal')?.classList.remove('open');
    _detachEvents();
}

function _initCanvas() {
    const canvas = document.getElementById('robot-table-canvas');
    if (!canvas) return;
    _draw(canvas, false);
    _attachEvents(canvas);
}

// ── Drawing ──────────────────────────────────────────────────────────────────

function _draw(canvas, compact = false, theme = 'light') {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;   // 520
    const H = canvas.height;  // 360

    // Outside zones stay same pixel size (48px pads); table fills remaining space
    const LEFT_PAD = compact ? 10  : 100;
    const PAD_H    = compact ? 10  : 100;  // right — equal to LEFT_PAD → table centred
    const PAD_V    = compact ? 20  : 91;   // compact: no outside rails needed
    const tX = LEFT_PAD;
    const tY = PAD_V;
    const tW = W - LEFT_PAD - PAD_H;  // full:320 compact:320 — keeps 274:152.5 ratio
    const tH = H - PAD_V * 2;         // full:178 compact:178 ✓

    _layout = { tX, tY, tW, tH };

    ctx.clearRect(0, 0, W, H);

    // Background (skip in compact mode — canvas stays transparent)
    if (!compact) {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, W, H);
    }

    // Helper to draw a dashed outside zone
    const drawOutsideZone = (x, y, w, h) => {
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 5]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
    };

    // ── Left outside zone ──
    if (!compact) {
        drawOutsideZone(6, tY, tX - 10, tH);

        // ── Top outside zone — stretches left to match left zone's x=6 ──
        const nearHalfW = tW / 2;
        const outerW = (tX - 6) + nearHalfW;  // from canvas left edge to the net
        drawOutsideZone(6, 6, outerW, tY - 10); // bottom edge at tY-4 (4px gap)

        // ── Bottom outside zone — same width ──
        drawOutsideZone(6, tY + tH + 4, outerW, H - (tY + tH + 4) - 6); // 4px gap
    }

    // ── Table surface ──
    ctx.fillStyle = '#1565C0';
    _rrFill(ctx, tX, tY, tW, tH, 5);

    // Table border
    const tableBorderColor = theme === 'night' ? '#ffffff' : '#4a4a4a';
    ctx.strokeStyle = tableBorderColor;
    ctx.lineWidth = 2.5;
    _rrStroke(ctx, tX, tY, tW, tH, 5);

    // Centre line (horizontal, doubles service line)
    ctx.beginPath();
    ctx.moveTo(tX + 3, tY + tH / 2);
    ctx.lineTo(tX + tW - 3, tY + tH / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Net (vertical line at length midpoint) ──
    const netX = tX + tW / 2;

    ctx.beginPath();
    ctx.moveTo(netX, tY - 5);
    ctx.lineTo(netX, tY + tH + 5);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(netX, tY - 5);
    ctx.lineTo(netX, tY + tH + 5);
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Net posts
    ctx.fillStyle = '#cccccc';
    const ph = 8, pw = 5;
    ctx.fillRect(netX - pw / 2, tY - ph, pw, ph);
    ctx.fillRect(netX - pw / 2, tY + tH, pw, ph);

    // ── Robot ──
    const rW = tW * ROB_W;
    const rH = tH * ROB_H;
    const rcx = tX + (robotPos.x + ROB_W / 2) * tW;   // centre = left-edge + half-width
    const rcy = tY + (0.5 + robotPos.y) * tH;          // centre = table-mid + y-offset
    _drawRobot(ctx, rcx, rcy, rW, rH);

    // ── Saved-coords label (upper-right, non-compact only) ──
    if (!compact) {
        const xCm = (robotPos.x * 274).toFixed(1);        // left-edge in cm from near end
        const yCm = (robotPos.y * 152.5).toFixed(1);       // offset from table centre in cm
        const label = `(${xCm}, ${yCm})`;
        ctx.font = 'bold 12px monospace';
        const tw = ctx.measureText(label).width;
        const pad = 6, bh = 20;
        const bw = tw + pad * 2;
        const bx = W - bw - 8;
        const by = 8;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        _rrFill(ctx, bx, by, bw, bh, 5);
        ctx.fillStyle = '#e0e0e0';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + bw / 2, by + bh / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
}

function _drawRobot(ctx, cx, cy, w, h) {
    const x = cx - w / 2;
    const y = cy - h / 2;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    _rrFill(ctx, x + 3, y + 3, w, h, 7);

    // Body gradient
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, '#ff7a5c');
    grad.addColorStop(1, '#e84d28');
    ctx.fillStyle = grad;
    _rrFill(ctx, x, y, w, h, 7);

    // Body border
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.5;
    _rrStroke(ctx, x, y, w, h, 7);

    // ── Cannon (always faces right — robot stays on near/left side) ──
    const cannonLen = 11;
    const cannonW = Math.max(4, w * 0.28);

    ctx.fillStyle = '#2d3748';
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 1;

    ctx.fillRect(x + w - 2, cy - cannonW / 2, cannonLen, cannonW);
    ctx.strokeRect(x + w - 2, cy - cannonW / 2, cannonLen, cannonW);
    // Muzzle
    ctx.beginPath();
    ctx.arc(x + w + cannonLen - 2, cy, cannonW * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#111827';
    ctx.fill();
    ctx.strokeStyle = '#4a5568';
    ctx.stroke();

    // Centre dot
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
}

// ── Round-rect helpers ────────────────────────────────────────────────────────

function _rrPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}
function _rrFill(ctx, x, y, w, h, r)   { _rrPath(ctx, x, y, w, h, r); ctx.fill(); }
function _rrStroke(ctx, x, y, w, h, r) { _rrPath(ctx, x, y, w, h, r); ctx.stroke(); }

function _showCoordHint(canvas, x, y, tX, tY, tW, tH, redrawFn) {
    if (x < tX || x > tX + tW || y < tY || y > tY + tH) return;
    const nx = (x - tX) / tW;
    const ny = (y - tY) / tH;
    const xCm = (nx * 274).toFixed(1);
    const yCm = ((0.5 - ny) * 152.5).toFixed(1);
    const label = `(${xCm}, ${yCm})`;

    redrawFn();
    const ctx2d = canvas.getContext('2d');
    ctx2d.font = 'bold 13px sans-serif';
    const tw = ctx2d.measureText(label).width;
    const pad = 8, bh = 24;
    const bw = tw + pad * 2;
    const bx = Math.min(Math.max(x - bw / 2, 4), canvas.width - bw - 4);
    const by = y - bh - 12 < 4 ? y + 12 : y - bh - 12;
    ctx2d.fillStyle = 'rgba(0,0,0,0.78)';
    _rrFill(ctx2d, bx, by, bw, bh, 6);
    ctx2d.fillStyle = '#ffffff';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText(label, bx + bw / 2, by + bh / 2);
    ctx2d.textAlign = 'left';
    ctx2d.textBaseline = 'alphabetic';

    clearTimeout(canvas._coordTimeout);
    canvas._coordTimeout = setTimeout(redrawFn, 1500);
}

// Attach a dblclick coordinate hint to a compact (editor) canvas.
// Call after drawStaticRobot(canvas, true). Safe to call multiple times —
// removes the previous handler first.
export function attachTableClickHint(canvas) {
    if (!canvas) return;
    if (canvas._coordClickHandler) {
        canvas.removeEventListener('dblclick', canvas._coordClickHandler);
    }
    const handler = (e) => {
        if (!document.body.classList.contains('sim-mode')) return;
        const { x, y } = _getCoords(canvas, e);
        const tX = 10, tY = 20;
        const tW = canvas.width  - tX * 2;
        const tH = canvas.height - tY * 2;
        _showCoordHint(canvas, x, y, tX, tY, tW, tH, () => drawStaticRobot(canvas, true));
    };
    canvas._coordClickHandler = handler;
    canvas.addEventListener('dblclick', handler);
}

// ── Interaction ───────────────────────────────────────────────────────────────

function _getCoords(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * sx, y: (src.clientY - rect.top) * sy };
}

function _hitTest(x, y) {
    const { tX, tY, tW, tH } = _layout;
    const rW = tW * ROB_W;
    const rH = tH * ROB_H;
    const rcx = tX + (robotPos.x + ROB_W / 2) * tW;
    const rcy = tY + (0.5 + robotPos.y) * tH;
    const pad = 10;
    return x >= rcx - rW / 2 - pad && x <= rcx + rW / 2 + pad &&
           y >= rcy - rH / 2 - pad && y <= rcy + rH / 2 + pad;
}

function _updatePos(x, y) {
    const { tX, tY, tW, tH } = _layout;
    const H = tY * 2 + tH; // canvas height

    // Clamp left-edge and y-offset so robot body stays within the table
    const MIN_X = (6 - tX) / tW;                  // left-edge at outer left zone
    const MAX_X =  0.5 - ROB_W;                   // right edge (left + ROB_W) at net
    const MIN_Y = -(0.5 - ROB_H / 2);             // top of robot at top rail
    const MAX_Y =   0.5 - ROB_H / 2;              // bottom of robot at bottom rail

    robotPos.x = Math.max(MIN_X, Math.min(MAX_X, (x - tX) / tW - ROB_W / 2));
    robotPos.y = Math.max(MIN_Y, Math.min(MAX_Y, (y - tY) / tH - 0.5));
}


function _attachEvents(canvas) {
    const onDown = (e) => {
        const { x, y } = _getCoords(canvas, e);
        if (_hitTest(x, y)) {
            _isDragging = true;
            canvas.style.cursor = 'grabbing';
            e.preventDefault();
        }
    };
    const onMove = (e) => {
        if (_isDragging) {
            e.preventDefault();
            const { x, y } = _getCoords(canvas, e);
            _updatePos(x, y);
            _draw(canvas);
        } else {
            const { x, y } = _getCoords(canvas, e);
            canvas.style.cursor = _hitTest(x, y) ? 'grab' : 'default';
        }
    };
    const onUp = () => {
        if (_isDragging) {
            _isDragging = false;
            canvas.style.cursor = 'default';
            // position is NOT saved here — only on explicit Save button
        }
    };

    const onDblClick = (e) => {
        if (!document.body.classList.contains('sim-mode')) return;
        const { x, y } = _getCoords(canvas, e);
        const { tX, tY, tW, tH } = _layout;
        _showCoordHint(canvas, x, y, tX, tY, tW, tH, () => _draw(canvas, false));
    };

    canvas._robDown = onDown;
    canvas._robMove = onMove;
    canvas._robUp   = onUp;
    canvas._robDbl  = onDblClick;

    canvas.addEventListener('mousedown',  onDown);
    canvas.addEventListener('mousemove',  onMove);
    canvas.addEventListener('mouseup',    onUp);
    canvas.addEventListener('mouseleave', onUp);
    canvas.addEventListener('touchstart', onDown, { passive: false });
    canvas.addEventListener('touchmove',  onMove, { passive: false });
    canvas.addEventListener('touchend',   onUp);
    canvas.addEventListener('dblclick',   onDblClick);
}

function _detachEvents() {
    const canvas = document.getElementById('robot-table-canvas');
    if (!canvas || !canvas._robDown) return;
    canvas.removeEventListener('mousedown',  canvas._robDown);
    canvas.removeEventListener('mousemove',  canvas._robMove);
    canvas.removeEventListener('mouseup',    canvas._robUp);
    canvas.removeEventListener('mouseleave', canvas._robUp);
    canvas.removeEventListener('touchstart', canvas._robDown);
    canvas.removeEventListener('touchmove',  canvas._robMove);
    canvas.removeEventListener('touchend',   canvas._robUp);
    canvas.removeEventListener('dblclick',   canvas._robDbl);
    clearTimeout(canvas._coordTimeout);
}
