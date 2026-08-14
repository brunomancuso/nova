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
    for (const step of drill.steps) {
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
            const isTop = ball.type === 'top';
            card.innerHTML =
                `<span class="abc-text">` +
                `<span class="abc-label">Speed</span><span class="abc-val">${ball.speed}</span>` +
                `<span class="abc-label">Spin</span><span class="abc-val">${ball.spin}</span>` +
                `<span class="abc-freq">${ball.frequency} bpm</span>` +
                `</span>` +
                `<span class="abc-arrow ${isTop ? 'abc-up' : 'abc-down'}">${isTop ? '↑' : '↓'}</span>` +
                `<span class="abc-edit" title="Edit ball"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></span>` +
                `<span class="abc-play" title="Test ball"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>` +
                (idx > 1 ? `<span class="abc-move-up" title="Merge up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg></span>` : '') +
                (idx < total ? `<span class="abc-move-down" title="Merge down"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg></span>` : '');
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

render();
