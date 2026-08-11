import { 
    initData, 
    setMode, 
    store,
    saveDrillsToStorage,
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
} from './ui.js';

import { showToast } from './utils.js';

import { 
    startDrillSequence, 
    stopRun, 
    togglePause,
    skipCountdown, // <--- ADDED IMPORT
    sendSingleBall
} from './runner.js';

import { connectSimulator, disconnectSimulator, simLog } from './simulator.js';
import { openRobotPosModal, closeRobotPosModal, saveRobotPos, cancelRobotPos, resetRobotPos, applyRobotPos, drawStaticRobot, attachTableClickHint, drawAtCm, getRobotXcm, getLastBallCanvas } from './robot.js';
import { initCalibration } from './calibration.js';
import './adjust.js';

// --- Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
    await initData();
    renderDrillButtons();
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

window.handleDrillClick = (cat, index, name, btn) => {
    if (!bleState.isConnected) {
        showToast("Device not connected");
        return;
    }
    document.querySelectorAll('.btn-drill').forEach(b => b.classList.remove('running'));
    btn.classList.add('running');
    startDrillSequence(cat, name);
};