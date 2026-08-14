// js/alexaDrill.js — persistent drill/ball editing for Alexa mode.
import { Ball, Step, Drill } from './model/index.js';

const STORAGE_KEY = 'nova_alexa_drill';

const $ = (id) => document.getElementById(id);

let drill = load();
let editingStep = null;
let editingBall = null;

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

            const card = document.createElement('button');
            card.className = 'alexa-ball-card';
            if (prevStep === step) card.classList.add('chain-above');
            const isTop = ball.type === 'top';
            const isVariant = step.isVariant;
            const variantPos = isVariant ? step.variants.indexOf(ball) : -1;
            const isFirstVariant = isVariant && variantPos === 0;
            const isLastVariant = isVariant && variantPos === step.variants.length - 1;
            card.innerHTML =
                `<span class="abc-text">` +
                `<span class="abc-label">Speed</span><span class="abc-val">${ball.speed}</span>` +
                `<span class="abc-label">Spin</span><span class="abc-val">${ball.spin}</span>` +
                `<span class="abc-freq">${ball.frequency} bpm</span>` +
                `</span>` +
                `<span class="abc-arrow ${isTop ? 'abc-up' : 'abc-down'}">${isTop ? '↑' : '↓'}</span>` +
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
                    if (isVariant && !isFirstVariant) removeVariant(step, ball);
                    else mergeBalls(ballIdx, 'up');
                });
            }
            const moveDownBtn = card.querySelector('.abc-move-down');
            if (moveDownBtn) {
                moveDownBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (isVariant && !isLastVariant) removeVariant(step, ball);
                    else mergeBalls(ballIdx, 'down');
                });
            }

            if (window.getSelectedAlexaBall?.() === ballIdx) card.classList.add('selected');

            const heightPct = Math.max(0, Math.min(100, ((ball.height + 50) / 150) * 100));
            const pos = Math.max(3, Math.min(97, 100 - heightPct));
            const gauge = document.createElement('span');
            gauge.className = 'alexa-ball-height';
            gauge.style.setProperty('--pos', pos + '%');

            item.appendChild(label);
            item.appendChild(card);
            item.appendChild(gauge);
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

    if (upper.isVariant && lower.isVariant) {
        upper.variants.push(...lower.variants);
        drill.steps.splice(lowerIdx, 1);
    } else if (upper.isVariant && lower.isSingle) {
        upper.variants.push(lower.ball);
        drill.steps.splice(lowerIdx, 1);
    } else if (upper.isSingle && lower.isVariant) {
        lower.variants.unshift(upper.ball);
        drill.steps.splice(upperIdx, 1);
    } else if (upper.isSingle && lower.isSingle) {
        upper.variants = [upper.ball, lower.ball];
        upper.ball = null;
        drill.steps.splice(lowerIdx, 1);
    }
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

function removeVariant(step, ball) {
    if (!step || !step.isVariant) return;
    if (step.variants.length <= 1) return;
    const stepIndex = drill.steps.indexOf(step);
    const pos = step.variants.indexOf(ball);
    if (pos < 0) return;

    const above = step.variants.slice(0, pos);
    const below = step.variants.slice(pos + 1);

    // Keep the balls above in the original step (single if 1, variant if more).
    if (above.length === 1) {
        step.ball = above[0];
        step.variants = [];
    } else {
        step.variants = above;
    }

    // Removed ball becomes its own single step.
    const newSteps = [new Step({ ball })];

    // All balls below go into one new step (variant if >1, single if 1).
    if (below.length > 1) newSteps.push(new Step({ variants: below }));
    else if (below.length === 1) newSteps.push(new Step({ ball: below[0] }));

    drill.steps.splice(stepIndex + 1, 0, ...newSteps);

    // Drop the original step if it ended up empty.
    if (step.variants.length === 0 && !step.ball) {
        drill.steps.splice(stepIndex, 1);
    }

    save();
    render();
}

function openModal(step, ball) {
    editingStep = step;
    editingBall = ball;
    $('alexa-ball-speed').value = ball.speed;
    $('alexa-ball-spin').value = ball.spin;
    $('alexa-ball-freq').value = ball.frequency;
    $('alexa-ball-type').value = ball.type;
    $('alexa-ball-height').value = ball.height;
    $('alexa-ball-drop').value = ball.drop;
    $('alexa-ball-reps').value = ball.reps;
    $('alexa-ball-scatter').value = ball.scatter;
    $('alexa-ball-modal')?.classList.add('open');
}

function closeModal() {
    $('alexa-ball-modal')?.classList.remove('open');
}

window.addAlexaBall = () => {
    drill.steps.push(new Step({ ball: new Ball() }));
    save();
    render();
};

window.saveAlexaBall = () => {
    if (!editingBall) return;
    editingBall.speed = num('alexa-ball-speed');
    editingBall.spin = num('alexa-ball-spin');
    editingBall.frequency = num('alexa-ball-freq');
    editingBall.type = $('alexa-ball-type')?.value || 'top';
    editingBall.height = num('alexa-ball-height');
    editingBall.drop = num('alexa-ball-drop');
    editingBall.reps = num('alexa-ball-reps');
    editingBall.scatter = num('alexa-ball-scatter');
    editingBall.delay = 0;
    editingBall.clamp();
    save();
    render();
    closeModal();
};

window.deleteAlexaBall = () => {
    if (editingStep) {
        drill.steps = drill.steps.filter((s) => s !== editingStep);
        save();
        render();
    }
    closeModal();
};

window.updateAlexaBall = (index, patch) => {
    let i = 0;
    for (const step of drill.steps) {
        for (const ball of step.allBalls()) {
            i++;
            if (i === index) {
                if (patch && 'drop' in patch) ball.drop = patch.drop;
                if (patch && 'speed' in patch) ball.speed = patch.speed;
                ball.clamp();
                save();
                render();
                return true;
            }
        }
    }
    return false;
};

window.deleteAlexaDrill = () => {
    drill = new Drill('My Drill', { steps: [] });
    editingStep = null;
    editingBall = null;
    closeModal();
    save();
    render();
};

window.closeAlexaBallModal = closeModal;
window.renderAlexaBalls = render;

// ── Exposed for alexa.js → nova-agent integration ─────────────────────────
export function getAlexaDrill() {
    return drill.toJSON();
}

export function setAlexaDrill(json) {
    drill = Drill.fromJSON(json || {});
    save();
    render();
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
