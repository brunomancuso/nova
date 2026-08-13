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
    return new Drill('Alexa', { steps: [new Step({ ball: new Ball() })] });
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

    let idx = 0;
    for (const step of drill.steps) {
        for (const ball of step.allBalls()) {
            idx++;
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
                `<span class="abc-arrow ${isTop ? 'abc-up' : 'abc-down'}">${isTop ? '↑' : '↓'}</span>`;
            card.addEventListener('click', () => openModal(step, ball));

            item.appendChild(label);
            item.appendChild(card);
            box.appendChild(item);
        }
    }
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

window.closeAlexaBallModal = closeModal;

render();
