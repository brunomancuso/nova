import { 
    initData, 
    setLevel, 
    setMode, 
    resetStats, 
    importCustomDrills, 
    exportCustomDrills, 
    saveAsDefault, 
    resetToDefault, 
    factoryReset,
    appStats,
    userCustomDrills,
    currentDrills,
    saveDrillsToStorage,
    selectedLevel 
} from './state.js';

import { 
    connectDevice, 
    disconnectDevice, 
    bleState 
} from './bluetooth.js';

import { 
    openEditor, 
    closeEditor, 
    saveDrillChanges,
    toggleEditorMode
} from './editor.js';

import { 
    renderDrillButtons, 
    updateDrillButtonStates, 
    setTheme, 
    toggleMenu, 
    switchTab, 
    updateStatsUI,
    showSessionSummary 
} from './ui.js';

import { showToast } from './utils.js';

import { 
    startDrillSequence, 
    stopRun, 
    togglePause,
    skipCountdown, // <--- ADDED IMPORT
    sendSingleBall
} from './runner.js';

import { downloadDrill } from './cloud.js';
import { connectSimulator, disconnectSimulator, simLog } from './simulator.js';
import { openRobotPosModal, closeRobotPosModal, saveRobotPos, cancelRobotPos, resetRobotPos, drawStaticRobot, attachTableClickHint, drawAtCm, drawBall, getRobotXcm, getLastBallCanvas } from './robot.js';
import { calibrateKvKd, calibrateKms, predictX, predictY, DEFAULT_KV, DEFAULT_KD, DEFAULT_KMS } from './prediction.js';

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    initData();
    renderDrillButtons();
    updateStatsUI();
    setupEventListeners();

    // Seed default calibration values if none stored, or migrate any known stale defaults
    const _storedCal = localStorage.getItem(CAL_STORAGE_KEY);
    const _STALE = [
        { kv: 0.00691, kd: 0.19  },   // original over-damped default
        { kv: 0.00245, kd: 0.08  },   // incorrect recalibration
        { kv: 0.00245, kd: 0.125 },   // partial fix attempt
        { kv: 0.00691, kd: 0.125 },   // pre-angle-fix constants
    ];
    const _isStale = !_storedCal || (() => {
        try {
            const s = JSON.parse(_storedCal);
            return _STALE.some(o => s.kv === o.kv && s.kd === o.kd);
        } catch { return false; }
    })();
    if (_isStale) {
        localStorage.setItem(CAL_STORAGE_KEY, JSON.stringify({
            kv:  DEFAULT_KV,
            kd:  DEFAULT_KD,
            kms: DEFAULT_KMS,
        }));
    }

    // Restore simulator mode preference
    const simEnabled = localStorage.getItem('nova_sim_mode') === '1';
    if (simEnabled) {
        document.body.classList.add('sim-mode');
        simLog('Simulator mode enabled \u2014 click Connect to start');
    }

    // Restore inline stop preference
    if (localStorage.getItem('nova_inline_stop') === '1') {
        document.body.classList.add('inline-stop');
    }

    console.log("Nova Drill Control: Modules Loaded");
});

// --- Event Listeners Setup ---

function setupEventListeners() {
    const btnConnect = document.getElementById('btn-connect');
    if (btnConnect) {
        btnConnect.onclick = () => {
            const isSimMode = document.body.classList.contains('sim-mode');
            if (bleState.isConnected) {
                if (isSimMode) disconnectSimulator();
                else disconnectDevice();
            } else {
                if (isSimMode) connectSimulator();
                else connectDevice();
            }
        };
    }

    const inputStartPause = document.getElementById('input-start-pause');
    if (inputStartPause) {
        inputStartPause.onchange = (e) => {
            let val = parseInt(e.target.value);
            if (isNaN(val) || val < 0) val = 0;
            if (val > 10) val = 10;
            e.target.value = val;
        };
    }

    const inputPause = document.getElementById('input-pause');
    if (inputPause) {
        inputPause.onchange = (e) => {
            // Updated Logic: Seconds (0.0 - 5.0) with 0.1 step
            let val = parseFloat(e.target.value);
            if(isNaN(val)) val = 1.0;
            
            // Allow down to 0, max 5
            if(val < 0) val = 0; 
            if(val > 5.0) val = 5.0;
            
            e.target.value = val.toFixed(1);
        };
    }

    // --- NEW: Tap to Skip Countdown ---
    const runDisplay = document.getElementById('run-display');
    if (runDisplay) {
        runDisplay.onclick = () => {
            skipCountdown();
        };
    }
    // ----------------------------------

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('theme-menu');
        if (menu && menu.classList.contains('open') && 
            !menu.contains(e.target) && 
            !e.target.closest('.menu-btn')) {
            menu.classList.remove('open');
        }
    });

    document.addEventListener('drills-updated', () => {
        renderDrillButtons();
        updateDrillButtonStates();
    });
    
    // --- ADDED: Listen for stats reset ---
    document.addEventListener('stats-updated', () => {
        updateStatsUI();
    });
    
    document.addEventListener('connection-changed', () => {
        document.body.classList.toggle('connected', bleState.isConnected);
        updateDrillButtonStates();
        const editorModal = document.getElementById('editor-modal');
        if(editorModal && editorModal.classList.contains('open')) {
            const testBtns = document.querySelectorAll('.btn-act-test');
            testBtns.forEach(b => b.disabled = !bleState.isConnected);
        }
    });
}

// --- Window Binding for HTML Compatibility ---

window.toggleInlineStop = () => {
    const on = !document.body.classList.contains('inline-stop');
    document.body.classList.toggle('inline-stop', on);
    localStorage.setItem('nova_inline_stop', on ? '1' : '0');
    showToast(on ? 'Inline Stop ON' : 'Inline Stop OFF');
};

window.toggleSimulatorMode = () => {
    const checked = !document.body.classList.contains('sim-mode');
    document.body.classList.toggle('sim-mode', checked);
    localStorage.setItem('nova_sim_mode', checked ? '1' : '0');
    if (checked) {
        const startInput = document.getElementById('input-start-pause');
        if (startInput) startInput.value = 0;
        simLog('Simulator mode enabled \u2014 click Connect to start');
        showToast('Simulator ON');
    } else {
        showToast('Simulator OFF');
        if (bleState.isConnected) {
            disconnectSimulator();
        }
    }
};

window.toggleMenu = toggleMenu;
window.setTheme = setTheme;
window.switchTab = switchTab;

window.setLevel = (lvl, btn) => {
    setLevel(lvl);
    document.querySelectorAll('.lvl-dot').forEach(d => d.classList.remove('active'));
    if(btn) btn.classList.add('active');
};

window.setMode = (mode, btn) => {
    setMode(mode);
    document.querySelectorAll('.mode-option').forEach(d => d.classList.remove('active'));
    if(btn) btn.classList.add('active');
    
    const uiReps = document.getElementById('ui-reps');
    const uiTime = document.getElementById('ui-time');
    if(mode === 'reps') {
        uiReps?.classList.remove('hidden');
        uiTime?.classList.add('hidden');
    } else {
        uiReps?.classList.add('hidden');
        uiTime?.classList.remove('hidden');
    }
};

window.resetStats = resetStats;
window.saveAsDefault = saveAsDefault;
window.resetToDefault = resetToDefault;
window.factoryReset = factoryReset;
window.exportCustomDrills = exportCustomDrills;

window.handleCSVUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) { 
        const success = importCustomDrills(e.target.result);
        if(success) {
            renderDrillButtons();
            toggleMenu(); 
        }
    };
    reader.readAsText(file);
    event.target.value = '';
};

window.openEditor = openEditor;
window.closeEditor = closeEditor;
window.saveDrillChanges = saveDrillChanges;
window.togglePause = togglePause;
window.stopRun = stopRun;
window.openRobotPosModal  = openRobotPosModal;
window.closeRobotPosModal = closeRobotPosModal;
window.saveRobotPos       = saveRobotPos;
window.cancelRobotPos     = cancelRobotPos;
window.resetRobotPos      = resetRobotPos;
window.drawStaticRobot       = drawStaticRobot;
window.getLastBallCanvas = getLastBallCanvas;

// ── Calibration modal ────────────────────────────────────────────────────────
// Target landing positions (cm from near end): 6/8, 7/8, far end of table
const CAL_BALL_X      = [274 * 6 / 8 - 2, 274 * 7 / 8 - 2, 274 - 2];
const CAL_BH          = 50;
const CAL_DP          = 0;
const CAL_FREQ        = 0;
const CAL_REPS        = 1;
const CAL_STORAGE_KEY = 'nova_calibration';

// Phase 1 → spin=0, 3 balls → calibrate kv+kd
// Phase 2 → spin=5, 3 balls → calibrate kMS
// done   → show Save button
let _calPhase        = 1;
let _calBalls        = [{ speed: 2 }, { speed: 5 }, { speed: 8 }];
let _calSelectedBall = 0;
let _calPhase1Shots  = [];   // recorded {speed,spin,angle,x} for phase 1
let _calPhase2Shots  = [];   // recorded {speed,spin,angle,x} for phase 2
let _calResult       = { kv: null, kd: null, kms: null };

function _loadCalibration() {
    try {
        const s = JSON.parse(localStorage.getItem(CAL_STORAGE_KEY));
        if (s && typeof s.kv === 'number') return s;
    } catch (_) {}
    return null;
}

function _drawCalCanvas() {
    const canvas = document.getElementById('calibration-table-canvas');
    if (!canvas) return;
    drawBall(canvas, CAL_BALL_X[_calSelectedBall]);
}

function _refreshResultsPanel() {
    const panel   = document.getElementById('cal-results-panel');
    const saveBtn = document.getElementById('cal-save-btn');
    if (!panel) return;

    const stored  = _loadCalibration();
    const hasCur  = _calResult.kv !== null;
    let html = '';

    if (hasCur) {
        html += `<div class="cal-result-section">Result</div>`;
        html += `<div class="cal-result-row"><span class="cal-result-lbl">kv</span><span class="cal-result-val">${_calResult.kv.toFixed(5)}</span></div>`;
        html += `<div class="cal-result-row"><span class="cal-result-lbl">kd</span><span class="cal-result-val">${_calResult.kd.toFixed(4)}</span></div>`;
        if (_calResult.kms !== null) {
            html += `<div class="cal-result-row"><span class="cal-result-lbl">kMS</span><span class="cal-result-val">${_calResult.kms.toFixed(4)}</span></div>`;
        }
    }

    if (!hasCur && stored) {
        html += `<div class="cal-result-section">Stored</div>`;
        html += `<div class="cal-result-row"><span class="cal-result-lbl">kv</span><span class="cal-result-val">${stored.kv.toFixed(5)}</span></div>`;
        html += `<div class="cal-result-row"><span class="cal-result-lbl">kd</span><span class="cal-result-val">${stored.kd.toFixed(4)}</span></div>`;
        if (stored.kms != null) {
            html += `<div class="cal-result-row"><span class="cal-result-lbl">kMS</span><span class="cal-result-val">${stored.kms.toFixed(4)}</span></div>`;
        }
    }

    panel.innerHTML = html;
    if (saveBtn) saveBtn.style.display = (_calResult.kms !== null) ? '' : 'none';
}

function _refreshCalUI() {
    const slider     = document.getElementById('cal-speed-slider');
    const valEl      = document.getElementById('cal-speed-val');
    const phaseLabel = document.getElementById('cal-phase-label');
    const speed      = _calBalls[_calSelectedBall].speed;

    if (slider)     slider.value        = speed;
    if (valEl)      valEl.textContent   = speed;
    if (phaseLabel) phaseLabel.textContent =
        _calPhase === 1 ? 'Phase 1 · Spin 0' : 'Phase 2 · Spin 5';

    for (let i = 0; i < 3; i++) {
        document.getElementById(`cal-ball-${i}`)?.classList.toggle('selected', i === _calSelectedBall);
    }
    _drawCalCanvas();
    _refreshResultsPanel();
}

window.openCalibrationModal = () => {
    _calPhase        = 1;
    _calBalls        = [{ speed: 2 }, { speed: 5 }, { speed: 8 }];
    _calSelectedBall = 0;
    _calPhase1Shots  = [];
    _calPhase2Shots  = [];
    _calResult       = { kv: null, kd: null, kms: null };
    document.getElementById('calibration-modal')?.classList.add('open');
    requestAnimationFrame(_refreshCalUI);
};

window.closeCalibrationModal = () => {
    document.getElementById('calibration-modal')?.classList.remove('open');
};

window.calSelectBall = (i) => {
    _calSelectedBall = i;
    _refreshCalUI();
};

window.calSpeedChanged = (val) => {
    _calBalls[_calSelectedBall].speed = parseFloat(val);
    document.getElementById('cal-speed-val').textContent = val;
    _drawCalCanvas();
};

window.nextCalibrationBall = () => {
    // Record the current ball
    const shot = {
        speed:  _calBalls[_calSelectedBall].speed,
        spin:   _calPhase === 1 ? 0 : 5,
        angle: CAL_BH,
        x:      CAL_BALL_X[_calSelectedBall],
    };
    if (_calPhase === 1) _calPhase1Shots[_calSelectedBall] = shot;
    else                 _calPhase2Shots[_calSelectedBall] = shot;

    if (_calSelectedBall < 2) {
        // More balls in this phase
        _calSelectedBall++;
        _refreshCalUI();
        return;
    }

    // Last ball of the phase
    if (_calPhase === 1) {
        const { kv, kd } = calibrateKvKd(_calPhase1Shots, getRobotXcm());
        _calResult = { kv, kd, kms: null };
        // Begin phase 2
        _calPhase        = 2;
        _calBalls        = [{ speed: 2 }, { speed: 5 }, { speed: 8 }];
        _calSelectedBall = 0;
        _calPhase2Shots  = [];
    } else {
        const kms = calibrateKms(_calPhase2Shots, _calResult.kv, _calResult.kd, getRobotXcm());
        _calResult.kms   = kms;
        _calSelectedBall = 0;   // reset stepper; Save button now visible
    }
    _refreshCalUI();
};

window.sendCalibrationBall = async () => {
    if (!bleState.isConnected) { showToast('Device not connected'); return; }
    const spd       = _calBalls[_calSelectedBall].speed;
    const baseRpm   = Math.round(970 + 630.5 * spd);
    const spinDelta = _calPhase === 2 ? Math.round(342 * 5) : 0;
    const ok = await sendSingleBall(baseRpm + spinDelta, baseRpm - spinDelta, CAL_BH, CAL_DP, CAL_FREQ, CAL_REPS);
    if (ok) showToast('Calibration ball sent');
};

window.saveCalibrationResult = () => {
    localStorage.setItem(CAL_STORAGE_KEY, JSON.stringify(_calResult));
    showToast('Calibration saved');
    window.closeCalibrationModal();
};

window.resetCalibration = () => {
    localStorage.setItem(CAL_STORAGE_KEY, JSON.stringify({
        kv:  DEFAULT_KV,
        kd:  DEFAULT_KD,
        kms: DEFAULT_KMS,
    }));
    _calResult = { kv: null, kd: null, kms: null };
    showToast('Calibration reset to defaults');
    window.closeCalibrationModal();
};

// Draw a predicted ball landing on an editor canvas using stored calibration.
// Falls back to default physics constants if no calibration has been saved.
window.drawEditorBall = (canvas, speed, spin, angle, drop = 0) => {
    const stored = _loadCalibration();
    const kv  = stored?.kv  ?? DEFAULT_KV;
    const kd  = stored?.kd  ?? DEFAULT_KD;
    const kMS = stored?.kms ?? DEFAULT_KMS;
    const xFlight = predictX(angle, spin, speed, { kv, kd, kMS });
    const cannonM = getRobotXcm() + 40;   // cm: robot position + robot depth
    const yCm = predictY(drop, xFlight);
    drawBall(canvas, xFlight + cannonM, yCm);
};
window.toggleEditorMode   = toggleEditorMode;
window.simLog             = simLog;

window.handleDrillClick = (key, btn) => {
    if (!bleState.isConnected) {
        showToast("Device not connected");
        return;
    }
    document.querySelectorAll('.btn-drill').forEach(b => b.classList.remove('running'));
    btn.classList.add('running');
    startDrillSequence(key);
};

// --- DOWNLOAD MODAL LOGIC (New) ---

let selectedDownloadCat = 'custom-a';

// 1. Open the Modal
window.handleDownloadDialog = () => {
    // Close main menu if open
    const menu = document.getElementById('theme-menu');
    if(menu) menu.classList.remove('open');

    // Reset State
    selectedDownloadCat = 'custom-a';
    const codeInput = document.getElementById('dl-code');
    if (codeInput) codeInput.value = '';
    
    // Reset Switch UI to default (A)
    const switchEl = document.getElementById('dl-cat-switch');
    if(switchEl) {
        Array.from(switchEl.children).forEach(c => c.classList.remove('active'));
        if(switchEl.children[0]) switchEl.children[0].classList.add('active'); 
    }

    const modal = document.getElementById('download-modal');
    if(modal) {
        modal.classList.add('open');
        setTimeout(() => { if(codeInput) codeInput.focus(); }, 100);
    }
};

// 2. Close the Modal
window.closeDownloadModal = () => {
    const modal = document.getElementById('download-modal');
    if(modal) modal.classList.remove('open');
};

// 3. Handle Tab Switching inside Modal
window.selectDlCategory = (val, btn) => {
    selectedDownloadCat = val;
    if(btn && btn.parentElement) {
        Array.from(btn.parentElement.children).forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
    }
};

// 4. Perform Download
window.performDownload = async () => {
    const codeInput = document.getElementById('dl-code');
    if(!codeInput) return;
    
    const code = codeInput.value.trim().toUpperCase();

    if (code.length !== 6) {
        showToast("Invalid code (Must be 6 chars)");
        return;
    }

    // Check capacity before calling server
    // UPDATED LIMIT: 100
    if (userCustomDrills[selectedDownloadCat].length >= 100) {
        const catChar = selectedDownloadCat.split('-')[1].toUpperCase();
        showToast(`Bank ${catChar} is full!`);
        return;
    }

    showToast("Searching...");

    try {
        const data = await downloadDrill(code);
        if (!data) {
            showToast("Code not found");
            return;
        }

        let name = data.name;
        // Check for duplicates in the specific target category
        const existingNames = userCustomDrills[selectedDownloadCat].map(d => d.name);
        if (existingNames.includes(name)) {
            name = `${name} (Imp)`;
        }

        // Unique Key Generation
        const catChar = selectedDownloadCat.split('-')[1].toUpperCase();
        const newKey = `cust_${catChar}_${name.replace(/\s+/g, '_')}_${Date.now()}`;

        // Save Data
        userCustomDrills[selectedDownloadCat].push({ name: name, key: newKey });
        
        const newDrillObj = { 1: [], 2: [], 3: [], random: data.random };
        newDrillObj[selectedLevel] = data.params; 
        currentDrills[newKey] = newDrillObj;

        localStorage.setItem('custom_data', JSON.stringify(userCustomDrills));
        saveDrillsToStorage();

        // UI Refresh
        renderDrillButtons();
        window.closeDownloadModal();
        
        // Auto-switch to the target tab
        const tabBtn = document.querySelector(`.tab-btn[onclick*="${selectedDownloadCat}"]`);
        if (tabBtn) switchTab(selectedDownloadCat, tabBtn);

        showToast(`Imported to ${catChar}`);
        toggleMenu(); // Close main menu if it was open behind modal

    } catch (e) {
        console.error(e);
        showToast("Download Error");
    }
};