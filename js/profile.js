// ── Drill profiles ─────────────────────────────────────────────────────────
// A profile is nothing but the name of the drill data file it maps to:
//     drills_data.<profile>.json      (profile name in the file is lowercase)
//
// Profile names are shown/entered in UPPERCASE; the matching file name is the
// lowercase form, e.g. profile "MAIN" → drills_data.main.json.
//
// The active profile is kept in sessionStorage, so a reload inside the same
// browser session keeps it while a new session asks the user to pick one.
// Profiles are created by the user (New / Copy); there is no built-in profile.
//
// "New" and "Copy" create the matching file through the dev server
// (POST /api/profiles). On a plain static host only the files that ship with
// the app can be used.

import {
    getStoreJSON,
    loadDrillsFromCache,
    fetchDrills,
    saveDrillsToCache,
    onDrillsSaved,
} from './state.js';
import { showToast, toggleBodyScroll } from './utils.js';

const SESSION_KEY = 'nova_profile';
const OWNER_KEY   = 'nova_drills_owner';   // profile the cached drills belong to
const FALLBACK_FILE = 'drills_data.json';  // used while no profile is selected
const NAME_RE = /^[A-Z0-9][A-Z0-9 _-]{0,31}$/;

let _profiles   = [];
let _selected   = null;
let _resolvePick = null;
let _syncTimer  = null;
let _nameMode   = null;   // 'new' | 'copy' | 'rename'

/** Profile names are always uppercase. */
function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

// ── Active profile ────────────────────────────────────────────────────────

export function getActiveProfile() {
    try {
        const name = sessionStorage.getItem(SESSION_KEY);
        return name ? normalizeName(name) : null;
    } catch (_) { return null; }
}

function setActiveProfile(name) {
    try {
        if (name) sessionStorage.setItem(SESSION_KEY, normalizeName(name));
        else sessionStorage.removeItem(SESSION_KEY);
    } catch (_) { /* sessionStorage unavailable */ }
    updateProfileChip();
}

export function updateProfileChip() {
    const name = getActiveProfile();
    const label = document.getElementById('profile-chip-name');
    const chip  = document.getElementById('profile-chip');
    if (label) label.textContent = name || 'PROFILE';
    if (chip)  chip.title = name ? `Profile: ${name} — tap to switch` : 'Select profile';
}

export function profileFileName(name) { return `drills_data.${normalizeName(name).toLowerCase()}.json`; }

// ── Profile list ──────────────────────────────────────────────────────────

async function listProfiles() {
    try {
        const res = await fetch('/api/profiles', { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            // Names are uppercase; de-duplicate in case old lowercase files exist.
            const names = (data?.profiles || []).map(normalizeName).filter(n => NAME_RE.test(n));
            return [...new Set(names)].sort((a, b) => a.localeCompare(b));
        }
    } catch (_) { /* static host — profiles cannot be listed */ }
    return [];
}

// ── Loading / switching ───────────────────────────────────────────────────

/** Drills shown while no profile is selected: cache, else drills_data.json. */
async function loadFallbackDrills() {
    if (loadDrillsFromCache()) return;
    try {
        await fetchDrills(FALLBACK_FILE);
        saveDrillsToCache();
    } catch (e) {
        console.warn(`[profile] cannot load ${FALLBACK_FILE}:`, e);
    }
}

/** Load the drill data for a profile. Returns 'cache' | 'file' | 'missing'. */
async function loadProfileData(name) {
    const cachedOwner = localStorage.getItem(OWNER_KEY);
    const hasCache    = !!localStorage.getItem('nova_drills');

    // The cached drills already belong to this profile → keep them
    // (this preserves edits that have not been written back yet).
    if (hasCache && cachedOwner === name) {
        loadDrillsFromCache();
        return 'cache';
    }

    try {
        await fetchDrills(profileFileName(name));
    } catch (e) {
        console.warn(`[profile] cannot load ${profileFileName(name)}:`, e);
        loadDrillsFromCache();          // keep whatever we already have
        return 'missing';
    }

    localStorage.setItem(OWNER_KEY, name);
    saveDrillsToCache();                // mirror the file locally (no write-back)
    return 'file';
}

export async function selectProfile(name) {
    const clean = normalizeName(name);
    if (!NAME_RE.test(clean)) {
        showToast('Invalid profile name');
        return getActiveProfile();
    }

    const previous = getActiveProfile();
    setActiveProfile(clean);
    const source = await loadProfileData(clean);

    if (source === 'missing') {
        // No such file — undo the switch instead of pointing at nothing.
        setActiveProfile(previous || clean);
        showToast(`Profile "${clean}" has no data file`);
    } else {
        showToast(`Profile: ${clean}`);
    }

    document.dispatchEvent(new CustomEvent('drills-updated'));
    return getActiveProfile();
}

/** Called once at startup: resolves the session profile or asks the user. */
export async function initProfiles() {
    onDrillsSaved(scheduleProfileSync);

    _profiles = await listProfiles();
    const active = getActiveProfile();

    // Reload inside the same session → silently keep the profile.
    if (active && _profiles.includes(active)) {
        const source = await loadProfileData(active);
        updateProfileChip();
        if (source === 'missing') showToast(`Profile "${active}" has no data file`);
        return active;
    }
    if (active) setActiveProfile(null);   // profile file is gone

    // Ask which profile to use; cancelling keeps the app on the plain
    // drills_data.json data until the user creates/selects a profile.
    const picked = await openPicker(null);
    if (!picked) {
        await loadFallbackDrills();
        document.dispatchEvent(new CustomEvent('drills-updated'));
        updateProfileChip();
        return null;
    }
    return await selectProfile(picked);
}

// ── Picker modal ──────────────────────────────────────────────────────────

function renderProfileList() {
    const list = document.getElementById('profile-list');
    if (!list) return;

    const active = getActiveProfile();

    if (!_profiles.length) {
        list.innerHTML = '<div class="profile-empty">No profiles yet — press New to create one.</div>';
        return;
    }

    list.innerHTML = _profiles.map(name => {
        const cls = [
            'profile-row',
            name === _selected ? 'selected' : '',
            name === active ? 'current' : '',
        ].filter(Boolean).join(' ');

        return `<button class="${cls}" onclick="window.selectProfileRow('${escapeAttr(name)}')">
            <span class="pr-name">${escapeHtml(name)}</span>
            ${name === active ? '<span class="pr-current">ACTIVE</span>' : ''}
            <span class="pr-check">✓</span>
        </button>`;
    }).join('');
}

function openPicker(preselect) {
    const modal = document.getElementById('profile-modal');
    if (!modal) return Promise.resolve(preselect || null);

    _selected = preselect || getActiveProfile() || _profiles[0] || null;
    cancelNameEntry();
    renderProfileList();
    toggleBodyScroll(true);
    modal.classList.add('open');

    return new Promise(resolve => { _resolvePick = resolve; });
}

function closePicker(result) {
    document.getElementById('profile-modal')?.classList.remove('open');
    cancelNameEntry();
    toggleBodyScroll(false);
    const resolve = _resolvePick;
    _resolvePick = null;
    if (resolve) resolve(result);
}

window.openProfileModal = async () => {
    _profiles = await listProfiles();
    const picked = await openPicker(getActiveProfile());
    if (picked && picked !== getActiveProfile()) await selectProfile(picked);
};

window.closeProfileModal = () => closePicker(getActiveProfile());
window.selectProfileRow  = (name) => { _selected = normalizeName(name); renderProfileList(); };
window.confirmProfileSelection = () => closePicker(_selected || null);
window.createProfilePrompt = () => startNameEntry('new');
window.copyProfilePrompt   = () => startNameEntry('copy');
window.renameProfilePrompt = () => startNameEntry('rename');
window.confirmProfileName  = confirmNameEntry;
window.cancelProfileName   = cancelNameEntry;

// ── New / Copy / Rename ───────────────────────────────────────────────────

function startNameEntry(mode) {
    const row   = document.getElementById('profile-new-row');
    const input = document.getElementById('profile-new-name');
    if (!row || !input) return;

    const base = _selected || getActiveProfile();
    if (mode !== 'new' && !base) { showToast('Select a profile first'); return; }

    _nameMode = mode;
    input.value = mode === 'copy'   ? `${base}-COPY`
                : mode === 'rename' ? base
                : `PROFILE-${_profiles.length + 1}`;
    row.classList.remove('hidden');
    input.focus();
    input.select();
}

function cancelNameEntry() {
    document.getElementById('profile-new-row')?.classList.add('hidden');
    _nameMode = null;
}

async function confirmNameEntry() {
    const input = document.getElementById('profile-new-name');
    const mode  = _nameMode;
    const name  = normalizeName(input?.value || '');
    if (!mode || !name) return;
    if (!NAME_RE.test(name)) { showToast('Invalid name (letters, digits, space, - _)'); return; }

    const base = _selected || getActiveProfile();
    if (_nameMode !== 'new' && !base) { showToast('Select a profile first'); return; }

    if (mode === 'rename' && name === base) { cancelNameEntry(); return; }
    if (_profiles.includes(name)) {
        showToast('That profile already exists');
        return;
    }

    let url = '/api/profiles';
    let body;
    if (mode === 'rename')      { url = '/api/profiles/rename'; body = { from: base, to: name }; }
    else if (mode === 'copy')   { body = { name, from: base }; }
    else                        { body = { name }; }

    let ok = false, status = 0;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        status = res.status;
        ok = res.ok;
    } catch (_) { ok = false; }

    if (!ok) {
        showToast(status === 409 ? 'That profile already exists' : 'Could not save the profile');
        return;
    }

    // Renaming the active profile: keep the session and cache owner in sync.
    if (mode === 'rename') {
        if (getActiveProfile() === base) setActiveProfile(name);
        if (localStorage.getItem(OWNER_KEY) === base) localStorage.setItem(OWNER_KEY, name);
    }

    cancelNameEntry();

    _profiles = await listProfiles();
    if (!_profiles.includes(name)) {
        _profiles.push(name);
        _profiles.sort((a, b) => a.localeCompare(b));
    }
    _selected = name;
    renderProfileList();
    updateProfileChip();

    showToast(mode === 'copy'   ? `Copied "${base}" → "${name}"`
            : mode === 'rename' ? `Renamed "${base}" → "${name}"`
            : `Profile "${name}" created`);
}

// ── Write-through to drills_data.<profile>.json ───────────────────────────

function scheduleProfileSync() {
    const name = getActiveProfile();
    if (!name) return;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => { void syncProfileFile(name); }, 800);
}

async function syncProfileFile(name) {
    if (getActiveProfile() !== name) return;
    try {
        const res = await fetch(`/api/profile/${encodeURIComponent(name.toLowerCase())}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getStoreJSON()),
        });
        if (res.ok) localStorage.setItem(OWNER_KEY, name);
    } catch (_) { /* no server API — the local cache is enough */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function escapeAttr(s) {
    return String(s).replace(/['\\]/g, c => (c === "'" ? "\\'" : '\\\\'));
}
