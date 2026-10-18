// js/alexaDrill.js — persistent drill/ball editing for Alexa mode.
import { Ball, Step, Drill } from './model/index.js';
import { showToast } from './utils.js';
import { bleState } from './bluetooth.js';
import { startDrillFromParams } from './runner.js';

const STORAGE_KEY = 'nova_alexa_drill';

const $ = (id) => document.getElementById(id);

let drill = load();
let editingStep = null;
let editingBall = null;
let pendingType = null; // rotation staged in the modal, applied on Save

function load() {
    try {
        const s = localStorage.getItem(STORAGE_KEY);
        if (s) return Drill.fromJSON(JSON.parse(s));
    } catch (e) {}
    return new Drill('My Drill', { steps: [] });
}

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(drill.toJSON()));
    } catch (e) {
        console.warn('Failed to save alexa drill:', e);
    }
}

function num(id) {
    const v = parseFloat($(id)?.value);
    return Number.isFinite(v) ? v : 0;
}

function render() {
    const box = $('alexa-balls');
    if (!box) return;
    box.innerHTML = '';

    let total = 0;
    for (const step of drill.steps) {
        total += step.allBalls().length;
    }

    let idx = 0;
    let prevStep = null;
    for (let si = 0; si < drill.steps.length; si++) {
        const step = drill.steps[si];
        const isFirstStep = si === 0;
        const isLastStep = si === drill.steps.length - 1;
        for (const ball of step.allBalls()) {
            idx++;
            const ballIdx = idx;
            const item = document.createElement('div');
            item.className = 'alexa-ball-item';

            const label = document.createElement('span');
            label.className = 'alexa-ball-index';
            label.textContent = String(idx);

            // Fixed-width column holding the number with its comment underneath,
            // so every ball card lines up horizontally.
            const head = document.createElement('div');
            head.className = 'alexa-ball-head';
            head.appendChild(label);

            const card = document.createElement('button');
            card.className = 'alexa-ball-card';
            if (prevStep === step) card.classList.add('chain-above');
            const isTop = ball.type === 'top';
            const isVariant = step.isVariant;
            const variantPos = isVariant ? step.balls.indexOf(ball) : -1;
            const isFirstVariant = isVariant && variantPos === 0;
            const isLastVariant = isVariant && variantPos === step.balls.length - 1;
            card.innerHTML =
                `<span class="abc-text">` +
                `<span class="abc-label">Speed</span><span class="abc-val">${ball.speed}</span>` +
                `<span class="abc-label">Spin</span><span class="abc-val">${ball.spin}</span>` +
                `<span class="abc-freq">${ball.frequency} bpm</span>` +
                `<span class="abc-height">H ${ball.height ?? 0}</span>` +
                `</span>` +
                `<span class="abc-edit" title="Edit ball"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></span>` +
                `<span class="abc-play" title="Test ball"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>` +
                (isVariant
                    ? (isFirstVariant
                        ? (!isFirstStep ? `<span class="abc-move-up" title="Merge up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg></span>` : '')
                        : `<span class="abc-move-up" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></span>`)
                    : (idx > 1 ? `<span class="abc-move-up" title="Merge up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg></span>` : '')) +
                (isVariant
                    ? (isLastVariant
                        ? (!isLastStep ? `<span class="abc-move-down" title="Merge down"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg></span>` : '')
                        : `<span class="abc-move-down" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></span>`)
                    : (idx < total ? `<span class="abc-move-down" title="Merge down"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg></span>` : ''));
            card.addEventListener('click', () => window.selectAlexaTableBall?.(ballIdx));
            const editBtn = card.querySelector('.abc-edit');
            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openModal(step, ball);
                });
            }
            const playBtn = card.querySelector('.abc-play');
            if (playBtn) {
                playBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.testAlexaBall?.(ballIdx);
                });
            }
            const moveUpBtn = card.querySelector('.abc-move-up');
            if (moveUpBtn) {
                moveUpBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (isVariant && !isFirstVariant) removeVariant(step, ball, 'up');
                    else mergeBalls(ballIdx, 'up');
                });
            }
            const moveDownBtn = card.querySelector('.abc-move-down');
            if (moveDownBtn) {
                moveDownBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (isVariant && !isLastVariant) removeVariant(step, ball, 'down');
                    else mergeBalls(ballIdx, 'down');
                });
            }

            if (window.getSelectedAlexaBall?.() === ballIdx) card.classList.add('selected');

            const spinArrow = document.createElement('span');
            const hasSpin = (ball.spin ?? 0) >= 1;
            spinArrow.className = 'alexa-ball-spin ' + (hasSpin ? (isTop ? 'top' : 'back') : 'gray');
            spinArrow.textContent = isTop ? '↑' : '↓';

            item.appendChild(label);

            if (ball.description) {
                const descWrap = document.createElement('span');
                descWrap.className = 'alexa-ball-desc-wrap';

                const desc = document.createElement('span');
                desc.className = 'alexa-ball-desc';
                desc.textContent = ball.description;
                desc.title = ball.description;

                const descEdit = document.createElement('button');
                descEdit.className = 'alexa-ball-desc-edit';
                descEdit.title = 'Edit comment';
                descEdit.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
                descEdit.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.openAlexaDescModal?.(ballIdx);
                });

                descWrap.appendChild(desc);
                descWrap.appendChild(descEdit);
                head.appendChild(descWrap);
            }

            item.appendChild(head);
            item.appendChild(card);
            item.appendChild(spinArrow);

            // Swap this ball with the next one in the list.
            const swapBtn = document.createElement('button');
            swapBtn.className = 'alexa-ball-swap';
            swapBtn.title = idx < total ? 'Swap with next ball' : 'No ball below to swap with';
            swapBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/></svg>';
            if (idx >= total) swapBtn.classList.add('ghost');
            swapBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.swapAlexaBallWithNext?.(ballIdx);
            });
            item.appendChild(swapBtn);

            box.appendChild(item);
            prevStep = step;
        }
    }

    renderMeta();
    window.drawAlexaTable?.();
}

function renderMeta() {
    const nameEl = $('alexa-drill-name');
    if (nameEl) nameEl.textContent = drill.name || '-';
    const randomEl = $('alexa-random');
    if (randomEl) randomEl.checked = !!drill.random;
}

function locateBall(flatIndex) {
    let count = 0;
    for (let si = 0; si < drill.steps.length; si++) {
        const balls = drill.steps[si].allBalls();
        for (let bi = 0; bi < balls.length; bi++) {
            count++;
            if (count === flatIndex) return { stepIndex: si, ballIndex: bi };
        }
    }
    return null;
}

function mergeStepIntoUpper(upperIdx, lowerIdx) {
    const upper = drill.steps[upperIdx];
    const lower = drill.steps[lowerIdx];

    // Merge two adjacent steps by concatenating their balls in order.
    upper.balls.push(...lower.balls);
    drill.steps.splice(lowerIdx, 1);
}

function mergeBalls(flatIndex, direction) {
    const cur = locateBall(flatIndex);
    if (!cur) return;
    const other = locateBall(flatIndex + (direction === 'down' ? 1 : -1));
    if (!other) return;
    if (cur.stepIndex === other.stepIndex) return;

    const upperIdx = Math.min(cur.stepIndex, other.stepIndex);
    const lowerIdx = Math.max(cur.stepIndex, other.stepIndex);
    mergeStepIntoUpper(upperIdx, lowerIdx);
    save();
    render();
}

function removeVariant(step, ball, dir) {
    if (!step || !step.isVariant) return;
    if (step.balls.length <= 1) return;
    const stepIndex = drill.steps.indexOf(step);
    const pos = step.balls.indexOf(ball);
    if (pos < 0) return;

    // Split the variant chain at this ball, keeping the order untouched:
    //  'down' → cut after the ball  (ball stays with the group above it)
    //  'up'   → cut before the ball (ball goes with the group below it)
    let above, below;
    if (dir === 'up') {
        above = step.balls.slice(0, pos);
        below = step.balls.slice(pos);
    } else {
        above = step.balls.slice(0, pos + 1);
        below = step.balls.slice(pos + 1);
    }
    if (above.length === 0 || below.length === 0) return;

    step.balls = above;
    drill.steps.splice(stepIndex + 1, 0, new Step({ balls: below }));

    save();
    render();
}

function openModal(step, ball) {
    editingStep = step;
    editingBall = ball;
    pendingType = ball.type;
    $('alexa-ball-speed').value = ball.speed;
    $('alexa-ball-spin').value = ball.spin;
    $('alexa-ball-freq').value = ball.frequency;
    setAlexaBallType(ball.type);
    $('alexa-ball-height').value = ball.height;
    $('alexa-ball-drop').value = ball.drop;
    $('alexa-ball-reps').value = ball.reps;
    $('alexa-ball-scatter').value = ball.scatter;
    $('alexa-ball-delay').value = ball.delay ?? 0;
    $('alexa-ball-desc').value = ball.description || '';
    $('alexa-ball-modal')?.classList.add('open');
}

function setAlexaBallType(type) {
    if (!editingBall) return;
    // Rotation is applied on Save (like every other modal field); here we only
    // stage the pending value and update the button visuals via CSS classes.
    pendingType = type;
    const top = $('alexa-type-top');
    const back = $('alexa-type-back');
    if (top) top.classList.toggle('active', type === 'top');
    if (back) back.classList.toggle('active', type === 'back');
}
window.setAlexaBallType = setAlexaBallType;

function closeModal() {
    pendingType = null;
    $('alexa-ball-modal')?.classList.remove('open');
}

// ── Comment (description) quick edit ──────────────
let editingDescIndex = null;

window.openAlexaDescModal = (flatIndex) => {
    const loc = locateBall(flatIndex);
    if (!loc) return;
    editingDescIndex = flatIndex;
    const input = $('alexa-desc-input');
    if (input) input.value = drill.steps[loc.stepIndex].balls[loc.ballIndex].description || '';
    $('alexa-desc-modal')?.classList.add('open');
    setTimeout(() => input?.focus(), 60);
};

window.closeAlexaDescModal = () => {
    editingDescIndex = null;
    $('alexa-desc-modal')?.classList.remove('open');
};

window.saveAlexaDesc = () => {
    if (editingDescIndex === null) return;
    const val = ($('alexa-desc-input')?.value || '').trim();
    const target = editingDescIndex;
    window.closeAlexaDescModal();
    window.updateAlexaBall?.(target, { description: val });
};

window.addAlexaBall = () => {
    drill.steps.push(new Step({ balls: [new Ball()] }));
    save();
    render();
};

// Duplicate the selected ball as a new step right after its own step.
window.copyAlexaBall = () => {
    const target = window.getSelectedAlexaBall?.();
    if (target === null || target === undefined) {
        showToast('Select a ball to copy');
        return;
    }
    let i = 0;
    for (const step of drill.steps) {
        for (const ball of step.allBalls()) {
            i++;
            if (i !== target) continue;
            const stepIndex = drill.steps.indexOf(step);
            drill.steps.splice(stepIndex + 1, 0, new Step({ balls: [ball.clone()] }));
            save();
            render();
            // Select the copy so the sliders target it right away. Deferred so
            // the document-level "click elsewhere" deselect can't undo it.
            setTimeout(() => window.selectAlexaTableBall?.(target + 1), 0);
            showToast('Ball copied');
            return;
        }
    }
};

window.saveAlexaBall = () => {
    if (!editingBall) return;
    editingBall.speed = num('alexa-ball-speed');
    editingBall.spin = num('alexa-ball-spin');
    editingBall.frequency = num('alexa-ball-freq');
    editingBall.height = num('alexa-ball-height');
    editingBall.drop = num('alexa-ball-drop');
    editingBall.reps = num('alexa-ball-reps');
    editingBall.scatter = num('alexa-ball-scatter');
    editingBall.delay = num('alexa-ball-delay');
    editingBall.description = ($('alexa-ball-desc')?.value || '').trim();
    editingBall.type = pendingType ?? editingBall.type;
    editingBall.clamp();
    save();
    render();
    closeModal();
};

window.deleteAlexaBall = () => {
    if (!editingStep || !editingBall) return;
    const stepIndex = drill.steps.indexOf(editingStep);
    if (stepIndex < 0) return;
    const pos = editingStep.balls.indexOf(editingBall);
    if (pos >= 0 && editingStep.balls.length > 1) {
        // Variant step — remove only the tapped ball.
        editingStep.balls.splice(pos, 1);
    } else {
        // Single/empty step — remove the whole step.
        drill.steps.splice(stepIndex, 1);
    }
    editingStep = null;
    editingBall = null;
    closeModal();
    save();
    render();
};

window.updateAlexaBall = (index, patch) => {
    let i = 0;
    for (const step of drill.steps) {
        for (const ball of step.allBalls()) {
            i++;
            if (i === index) {
                if (patch && 'drop' in patch) ball.drop = patch.drop;
                if (patch && 'speed' in patch) ball.speed = patch.speed;
                if (patch && 'spin' in patch) ball.spin = patch.spin;
                if (patch && 'height' in patch) ball.height = patch.height;
                if (patch && 'frequency' in patch) ball.frequency = patch.frequency;
                if (patch && 'delay' in patch) ball.delay = patch.delay;
                if (patch && 'scatter' in patch) ball.scatter = patch.scatter;
                if (patch && 'description' in patch) ball.description = patch.description;
                if (patch && 'type' in patch) ball.type = patch.type;
                ball.clamp();
                save();
                render();
                return true;
            }
        }
    }
    return false;
};

// Exchange a ball with the next ball in the list (works inside variant steps
// and across steps).
window.swapAlexaBallWithNext = (index) => {
    const flats = [];
    drill.steps.forEach((step) => {
        step.allBalls().forEach((ball, bi) => flats.push({ step, bi, ball }));
    });
    const a = flats[index - 1];
    const b = flats[index];
    if (!a || !b) return;
    a.step.balls[a.bi] = b.ball;
    b.step.balls[b.bi] = a.ball;
    save();
    render();
    window.selectAlexaTableBall?.(index);
    showToast('Balls swapped');
};

window.deleteAlexaDrill = () => {
    drill = new Drill('My Drill', { steps: [] });
    editingStep = null;
    editingBall = null;
    closeModal();
    save();
    render();
};

window.runAlexaDrill = () => {
    if (!bleState.isConnected) {
        showToast("Device not connected");
        return;
    }
    if (drill.steps.length === 0) {
        showToast('no balls to play');
        return;
    }
    // Fresh copies so the run doesn't mutate the stored drill.
    startDrillFromParams(drill.steps.map(s => s.clone()), drill.random, drill.name, drill.disableScatter, drill.deltaSpeed);
};

// Drills loaded from drills_data.json for the import picker.
let importDrills = null;

window.importAlexaDrill = async () => {
    const list = $('alexa-import-list');
    if (!list) return;
    $('alexa-import-modal')?.classList.add('open');
    list.innerHTML = '<p style="color:var(--text-light); text-align:center; padding:20px;">Loading…</p>';

    let data;
    try {
        const res = await fetch('drills_data.json');
        if (!res.ok) throw new Error('fetch failed');
        data = await res.json();
        importDrills = data;
    } catch {
        list.innerHTML = '<p style="color:var(--text-light); text-align:center; padding:20px;">Could not load drills_data.json</p>';
        return;
    }

    let html = '';
    for (const cat of ['dataA', 'dataB', 'dataC', 'dataD']) {
        const arr = data[cat] || [];
        if (!arr.length) continue;
        const label = 'Custom ' + cat.replace('data', '');
        html += `<div class="import-cat-sep" title="Importing from ${label}">
            <span class="import-cat-label">${label}</span>
            <span class="import-cat-count">${arr.length}</span>
        </div>`;
        arr.forEach((d, i) => {
            const ballCount = (d.steps || []).reduce((n, s) => n + (s.balls || []).length, 0);
            html += `<div onclick="window.importAlexaDrillFromList('${cat}', ${i})"
                 style="padding:10px 14px; margin-bottom:6px; border:1px solid var(--border); border-radius:8px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-right:8px;">${d.name || 'Untitled'}</span>
                <span style="font-size:0.7rem; color:var(--text-light); white-space:nowrap;">${ballCount} balls</span>
            </div>`;
        });
    }
    list.innerHTML = html || '<p style="color:var(--text-light); text-align:center; padding:20px;">No drills found in drills_data.json</p>';
};

window.closeAlexaImportModal = () => {
    $('alexa-import-modal')?.classList.remove('open');
};

window.importAlexaDrillFromList = (cat, index) => {
    const d = importDrills?.[cat]?.[index];
    if (!d) return;
    const imported = Drill.fromJSON(d);
    // Single-ball drills: the ball's comment becomes the drill name.
    // Multi-ball drills keep each source ball's own comment.
    const importedBalls = imported.steps.flatMap(s => s.allBalls());
    if (importedBalls.length === 1) {
        importedBalls[0].description = imported.name || d.name || '';
    }

    // Append to the drill already being edited instead of replacing it.
    const hadSteps = drill.steps.length > 0;
    drill.steps.push(...imported.steps);
    if (!hadSteps && imported.name) drill.name = imported.name;

    editingStep = null;
    editingBall = null;
    closeModal();
    save();
    render();
    window.closeAlexaImportModal();
    showToast(`Added "${d.name || 'drill'}"`);
};

window.closeAlexaBallModal = closeModal;
window.renderAlexaBalls = render;

// Load a whole drill into the designer (used by the drill-list design button).
window.loadAlexaDrill = (json) => {
    const loaded = Drill.fromJSON(json || {});
    const balls = loaded.steps.flatMap(s => s.allBalls());
    if (balls.length === 1) balls[0].description = loaded.name || balls[0].description;
    drill = loaded;
    editingStep = null;
    editingBall = null;
    closeModal();
    save();
    render();
};

// ── Exposed for alexa.js → nova-agent integration ─────────────────────────
export function getAlexaDrill() {
    return drill.toJSON();
}

export function setAlexaDrill(json) {
    drill = Drill.fromJSON(json || {});
    save();
    render();
}

// Comment modal: Enter saves, Escape cancels.
const descInput = $('alexa-desc-input');
if (descInput) {
    descInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            window.saveAlexaDesc();
        } else if (e.key === 'Escape') {
            window.closeAlexaDescModal();
        }
    });
}

// Random toggle wiring
const randomToggle = $('alexa-random');
if (randomToggle) {
    randomToggle.addEventListener('change', () => {
        drill.random = randomToggle.checked;
        save();
    });
}

// Double-click the exercise name → log the whole drill as JSON
const drillNameEl = $('alexa-drill-name');
if (drillNameEl) {
    drillNameEl.addEventListener('dblclick', () => {
        console.log(JSON.stringify(drill.toJSON(), null, 2));
    });
}

render();
