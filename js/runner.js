import { store, runMode, setLastPlayed } from './state.js';
import { Ball, Step } from './model/index.js';
import { sendPacket, packBall, bleState } from './bluetooth.js';
import { log, showToast, clamp, toggleBodyScroll } from './utils.js';
import { updateLastPlayedHighlight } from './ui.js';
import { setActiveDrillName, simLog } from './simulator.js';

let isRunning = false;
let isPaused = false;
let currentCount = 0;
let targetCount = 0;
let remainingTime = 0;

// Timers
let pauseTimer = null;
let countdownTimer = null;
let runTimer = null;
let startTimeout = null; // --- ADDED: Track the start delay
let _perBallDoneResolve = null; // resolves when DONE received between per-ball sends

let activeDrillParams = null;
let activeDrillRandom = false;
let activeDrillName = '';

// UI Elements (Cached for performance)
const ui = {
    overlay: document.getElementById('run-overlay'),
    display: document.getElementById('run-display'),
    label: document.getElementById('run-label'),
    progress: document.getElementById('run-progress'),
    btnPause: document.getElementById('btn-pause'),
    inlineSection: document.getElementById('inline-run-section'),
    inlineDisplay: document.getElementById('inline-run-display'),
    inlineLabel: document.getElementById('inline-run-label'),
    inlineBtnPause: document.getElementById('inline-btn-pause'),
};

function isInlineStop() { return document.body.classList.contains('inline-stop'); }

function openRunUI() {
    if (isInlineStop()) {
        if (ui.inlineSection) ui.inlineSection.classList.add('active');
    } else {
        ui.overlay.classList.add('open');
    }
}

function closeRunUI() {
    ui.overlay.classList.remove('open');
    if (ui.inlineSection) ui.inlineSection.classList.remove('active');
}

function setDisplay(val) {
    ui.display.textContent = val;
    if (ui.inlineDisplay) ui.inlineDisplay.textContent = val;
}

function setLabel(val) {
    ui.label.textContent = val;
    if (ui.inlineLabel) ui.inlineLabel.textContent = val;
}

function showPauseBtn(show) {
    ui.btnPause.style.display = show ? 'block' : 'none';
    if (ui.inlineBtnPause) ui.inlineBtnPause.style.display = show ? 'block' : 'none';
}

function updatePauseBtn(text, pulse) {
    ui.btnPause.textContent = text;
    if (ui.inlineBtnPause) ui.inlineBtnPause.textContent = text;
    if (pulse) {
        ui.btnPause.classList.add('pulse-anim');
        if (ui.inlineBtnPause) ui.inlineBtnPause.classList.add('pulse-anim');
    } else {
        ui.btnPause.classList.remove('pulse-anim');
        if (ui.inlineBtnPause) ui.inlineBtnPause.classList.remove('pulse-anim');
    }
}

export function startDrillSequence(cat, name) {
    const drill = store.findByName(cat, name);
    if(!drill || !drill.steps) {
         log("Drill data not found: " + cat + ":" + name);
         return;
    }

    // --- FILTER INACTIVE STEPS ---
    const executableSteps = drill.steps.filter(step => {
        if (!(step instanceof Step)) return true;
        const first = step.ball || step.variants[0];
        const isActive = first instanceof Ball ? first.side : 1;
        return isActive === undefined || isActive === 1;
    });

    if (executableSteps.length === 0) {
        showToast("no active balls to play");
        document.querySelectorAll('.btn-drill').forEach(b => b.classList.remove('running'));
        return;
    }
    
    activeDrillParams = executableSteps;
    activeDrillRandom = !!drill.random;
    activeDrillName = drill.name;
    
    // --- SAVE LAST PLAYED STATE ---
    setLastPlayed(cat, drill.name);
    updateLastPlayedHighlight();

    // --- LOCK SCROLL ON START ---
    if (!isInlineStop()) toggleBodyScroll(true);
    openRunUI();
    
    const startSecs = Math.max(0, Math.min(10, parseInt(document.getElementById('input-start-pause')?.value) || 0));
    let count = startSecs;

    setLabel("GET READY");
    showPauseBtn(false);
    ui.progress.style.transition = 'none';
    ui.progress.style.strokeDashoffset = '0';
    void ui.progress.offsetWidth;

    if (count === 0) {
        setDisplay("GO!");
        if (document.body.classList.contains('sim-mode')) simLog('▶  Starting…');
        startTimeout = setTimeout(beginDrillExecution, 800);
    } else {
        setDisplay(count);
        if (document.body.classList.contains('sim-mode')) simLog(`⏳  Countdown ${count} s`);
        requestAnimationFrame(() => {
            ui.progress.style.transition = `stroke-dashoffset ${count}s linear`;
            ui.progress.style.strokeDashoffset = '565';
        });

        countdownTimer = setInterval(() => {
            count--;
            if (count > 0) {
                setDisplay(count);
            } else {
                clearInterval(countdownTimer);
                setDisplay("GO!");
                if (document.body.classList.contains('sim-mode')) simLog('▶  Starting…');
                // --- UPDATED: Store timeout to allow cancelling ---
                startTimeout = setTimeout(beginDrillExecution, 800);
            }
        }, 1000);
    }
}

export function beginDrillExecution() {
    isRunning = true;
    isPaused = false;
    
    showPauseBtn(true);
    updatePauseBtn("PAUSE", false);
    setLabel("REMAINING");

    ui.progress.style.transition = 'none';
    ui.progress.style.strokeDashoffset = '0';

    if (runMode === 'time') {
        const tVal = document.getElementById('input-time').value;
        remainingTime = parseInt(tVal);
        setDisplay(formatTime(remainingTime));
        
        requestAnimationFrame(() => {
             if(isRunning && !isPaused) {
                 ui.progress.style.transition = `stroke-dashoffset ${remainingTime}s linear`;
                 ui.progress.style.strokeDashoffset = '565';
             }
        });

        runTimer = setInterval(() => {
            if (!isPaused) {
                remainingTime--;
                setDisplay(formatTime(remainingTime));
                if (remainingTime <= 0) stopRun();
            }
        }, 1000);
    } else {
        targetCount = parseInt(document.getElementById('input-reps').value) || 1;
        currentCount = 0;
        setDisplay(targetCount);
        ui.progress.style.transition = 'stroke-dashoffset 0.5s ease';
    }
    
    runIteration();
}

async function runIteration() {
    if(!isRunning || isPaused) return;

    if (runMode === 'reps') {
        currentCount++;
        const remaining = targetCount - currentCount;
        setDisplay(Math.max(0, remaining));
        
        const fractionCompleted = currentCount / targetCount;
        ui.progress.style.strokeDashoffset = 565 * fractionCompleted;
    }

    let sequence = activeDrillParams; 
    if (activeDrillRandom) {
        sequence = [...activeDrillParams]; 
        for (let i = sequence.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
        }
    }

    const balls = [];
    sequence.forEach((step, i) => {
        let tempBall;
        if (step instanceof Step) {
            tempBall = step.resolve();
        } else {
            // Legacy fallback: step is Ball[]
            const chosenOption = step[Math.floor(Math.random() * step.length)];
            tempBall = chosenOption instanceof Ball ? chosenOption.clone() : Ball.fromArray(chosenOption);
        }
        if (!(tempBall instanceof Ball)) return;
        tempBall = tempBall.clone();

        const scatter = tempBall.scatter || 0;
        if (scatter > 0) {
            const currentDrop = tempBall.drop;
            const minDrop = currentDrop - scatter;
            const maxDrop = currentDrop + scatter;
            const span = maxDrop - minDrop;
            const steps = Math.floor(span / 0.5);
            
            if (steps > 0) {
                const randomStep = Math.floor(Math.random() * (steps + 1));
                let newDrop = minDrop + (randomStep * 0.5);
                newDrop = clamp(newDrop, -10, 10);
                tempBall.drop = newDrop;
                log(`Scatter Active: Base ${currentDrop} ±${scatter} -> ${newDrop}`);
            }
        }

        log(`TX Ball ${i+1}: ${tempBall.topRPM} ${tempBall.bottomRPM} ${tempBall.height} ${tempBall.drop} ${tempBall.frequency} ${tempBall.reps} ${tempBall.side} ${tempBall.speed} ${tempBall.spin} ${tempBall.type} ${tempBall.scatter} ${tempBall.delay}`);
        balls.push(tempBall);
    });

    setActiveDrillName(activeDrillName);

    const hasDelays = balls.some(b => (b.delay ?? 0) > 0);
    if (!hasDelays) {
        // All balls in one packet (original behaviour)
        await sendPacket(buildPacket(balls.map(b => packBall(b.topRPM, b.bottomRPM, b.height, b.drop, b.frequency, b.reps))));
    } else {
        // Send each ball individually; wait for robot DONE before sending next
        for (let i = 0; i < balls.length; i++) {
            if (!isRunning) break;
            const delay = balls[i].delay ?? 0;
            if (delay > 0) await new Promise(r => setTimeout(r, delay));
            if (!isRunning) break;
            const b = balls[i];
            if (i < balls.length - 1) {
                // Intermediate ball: send then wait for DONE before continuing
                const donePromise = new Promise(r => { _perBallDoneResolve = r; });
                await sendPacket(buildPacket([packBall(b.topRPM, b.bottomRPM, b.height, b.drop, b.frequency, b.reps)]));
                await donePromise;
            } else {
                // Last ball: send and let the normal handleDone drive next iteration
                await sendPacket(buildPacket([packBall(b.topRPM, b.bottomRPM, b.height, b.drop, b.frequency, b.reps)]));
            }
        }
    }
}

// Callback from bluetooth.js when robot finishes
export function handleDone() {
    if(!isRunning) return;

    // If we're mid-sequence waiting for DONE before the next ball, resolve and return
    if (_perBallDoneResolve) {
        const res = _perBallDoneResolve;
        _perBallDoneResolve = null;
        res();
        return;
    }

    const isSim = document.body.classList.contains('sim-mode');
    if (isSim) simLog(`  ↩  handleDone: mode=${runMode}  rep=${currentCount}/${targetCount}`);
    
    if (runMode === 'reps' && currentCount >= targetCount) {
        if (isSim) simLog(`  ✅  Count reached — stopping`);
        stopRun();
        return;
    }
    
    const pauseInput = parseFloat(document.getElementById('input-pause').value);
    const pauseMs = (isNaN(pauseInput) ? 1.0 : pauseInput) * 1000;

    if (!isPaused) {
        if (pauseMs > 0 && isSim) {
            simLog(`  ⏸  pause ${(pauseMs / 1000).toFixed(1)} s`);
        }
        pauseTimer = setTimeout(() => { 
            if(isRunning && !isPaused) runIteration(); 
        }, pauseMs);
    }
}

export function togglePause() {
    if (isPaused) {
        isPaused = false;
        updatePauseBtn("PAUSE", false);
        
        if(runMode === 'time') {
             ui.progress.style.transition = `stroke-dashoffset ${remainingTime}s linear`;
             ui.progress.style.strokeDashoffset = '565';
        }
        runIteration(); 
    } else {
        isPaused = true;
        updatePauseBtn("RESUME", true);
        clearTimeout(pauseTimer);
        
        const computedStyle = window.getComputedStyle(ui.progress);
        const currentOffset = computedStyle.getPropertyValue('stroke-dashoffset');
        ui.progress.style.transition = 'none';
        ui.progress.style.strokeDashoffset = currentOffset;
        
        sendPacket([0x80,1,0,1]); 
    }
}

export function stopRun() {
    isRunning = false;
    isPaused = false;
    _perBallDoneResolve = null;
    clearInterval(countdownTimer);
    clearInterval(runTimer);
    clearTimeout(pauseTimer);
    clearTimeout(startTimeout); // --- ADDED: Clear start delay on stop
    
    // --- UNLOCK SCROLL ON STOP ---
    toggleBodyScroll(false);
    closeRunUI();
    document.querySelectorAll('.btn-drill').forEach(b => b.classList.remove('running'));
    
    sendPacket([0x80,1,0,1]); // Stop command
    log("Drill Stopped");
}

// --- NEW FUNCTION: Skip Countdown ---
export function skipCountdown() {
    // Only execute if NOT running and overlay/inline IS open (i.e., we are in countdown state)
    if (isRunning) return;
    if (!ui.overlay.classList.contains('open') && !ui.inlineSection?.classList.contains('active')) return;
    
    // Cancel any pending start mechanisms
    clearInterval(countdownTimer);
    clearTimeout(startTimeout);
    
    // Visual feedback
    setDisplay("GO!");
    
    // Start immediately
    beginDrillExecution();
}

function formatTime(s) {
    return `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
}

// Send a single ball immediately (for calibration / test shots)
export async function sendSingleBall(us, ls, bh, dp, freq, reps) {
    if (!bleState.isConnected) return false;
    const packet = buildPacket([packBall(us, ls, bh, dp, freq, reps)]);
    await sendPacket(packet);
    return true;
}

function buildPacket(balls) {
    const b = new ArrayBuffer(7 + balls.length*24);
    const v = new DataView(b);
    v.setUint8(0, 0x81); v.setUint16(1, 4+balls.length*24, true);
    v.setUint8(3, 1); v.setUint16(4, 1, true); v.setUint8(6, 0);
    const u = new Uint8Array(b);
    let off = 7;
    balls.forEach(ba => { u.set(ba, off); off+=24; });
    return u;
}