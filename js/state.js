import { DrillStore } from './model/index.js';

export let store = new DrillStore();
export let runMode = "reps";

// --- Last Played State ---
export let lastPlayedDrill = localStorage.getItem('nova_last_played');

export function setLastPlayed(cat, name) {
    lastPlayedDrill = `${cat}:${name}`;
    localStorage.setItem('nova_last_played', lastPlayedDrill);
}
// ------------------------------

export async function initData() {
    const savedTheme = localStorage.getItem('nova_theme_pref');
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

    try {
        const saved = localStorage.getItem('nova_drills');
        if (saved) {
            store = DrillStore.fromJSON(JSON.parse(saved));
        } else {
            const res = await fetch('drills_data.json');
            if (res.ok) {
                store = DrillStore.fromJSON(await res.json());
            }
        }
    } catch(e) {
        console.warn('Failed to load drills:', e);
    }
}

export function setMode(mode) { runMode = mode; }

export function saveDrillsToStorage() {
    try {
        localStorage.setItem('nova_drills', JSON.stringify(store.toJSON()));
    } catch(e) {
        console.error('Failed to save drills:', e);
    }
}