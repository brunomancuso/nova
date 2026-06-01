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
import { openRobotPosModal, closeRobotPosModal, saveRobotPos, cancelRobotPos, resetRobotPos, applyRobotPos, drawStaticRobot, attachTableClickHint, drawAtCm, getRobotXcm, getLastBallCanvas } from './robot.js';
import { initCalibration } from './calibration.js';
import './adjust.js';

// --- Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
    await initData();
    renderDrillButtons();
    updateStatsUI();
    setupEventListeners();

    initCalibration();

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
    // Prevent Android long-press context menu when dragging sliders / canvas balls
    document.addEventListener('contextmenu', e => e.preventDefault());

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
window.applyRobotPos      = applyRobotPos;
window.drawStaticRobot    = drawStaticRobot;
window.getLastBallCanvas  = getLastBallCanvas;
window.getRobotXcm        = getRobotXcm;

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