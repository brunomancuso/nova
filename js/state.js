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

// --- Selected Drill State (highlighted panel in the main list) ---
export let selectedDrill = localStorage.getItem('nova_selected_drill') || null;

export function setSelectedDrill(cat, name) {
    selectedDrill = (cat && name) ? `${cat}:${name}` : null;
    if (selectedDrill) localStorage.setItem('nova_selected_drill', selectedDrill);
    else localStorage.removeItem('nova_selected_drill');
}
// ------------------------------

// Theme only. Drills are loaded per profile — see js/profile.js.
export async function initData() {
    const savedTheme = localStorage.getItem('nova_theme_pref');
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
}

export function setMode(mode) { runMode = mode; }

// ── Drill data loading (used by the profile loader) ──────────────────────

export function getStoreJSON() { return store.toJSON(); }

export function loadDrillsFromCache() {
    try {
        const saved = localStorage.getItem('nova_drills');
        if (!saved) return false;
        store = DrillStore.fromJSON(JSON.parse(saved));
        return true;
    } catch(e) {
        console.warn('Failed to load saved drills:', e);
        return false;
    }
}

export async function fetchDrills(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    store = DrillStore.fromJSON(await res.json());
    return store;
}

let _afterSave = null;
export function onDrillsSaved(cb) { _afterSave = cb; }

/** Write the local cache only (used when a profile file is loaded). */
export function saveDrillsToCache() {
    try {
        localStorage.setItem('nova_drills', JSON.stringify(store.toJSON()));
    } catch(e) {
        console.error('Failed to save drills:', e);
    }
}

/** Write the local cache and notify listeners (profile write-through). */
export function saveDrillsToStorage() {
    saveDrillsToCache();
    if (_afterSave) { try { _afterSave(); } catch(_) {} }
}