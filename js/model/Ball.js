// ─── Ball Model ───────────────────────────────────────────────────────────
// Single ball configuration. JSON serialization uses named fields.
// RPMs are derived from speed/spin/type and computed on demand (not stored).

import { RPM_MIN, RPM_MAX, SPIN_LIMITS } from '../constants.js';
import { clamp } from './helpers.js';

export class Ball {
    constructor({
        height    = 50,
        drop      = 0,
        frequency = 50,
        reps      = 1,
        speed     = 2,
        spin      = 2,
        type      = 'top',
        scatter   = 0,
        delay     = 0,
    } = {}) {
        this.height    = height;    // int  -50..100   Launch height
        this.drop      = drop;      // num  -10..10    Landing position offset (0.5 steps)
        this.frequency = frequency; // int  30–120     Balls per minute (BPM)
        this.reps      = reps;      // int  1–200      Repetitions
        this.speed     = speed;     // num  0–10       Abstract speed level
        this.spin      = spin;      // num  0–10       Spin intensity
        this.type      = type;      // 'top'|'back'    Spin direction
        this.scatter   = scatter;   // num  0–10       Random drop variation
        this.delay     = delay;     // int  0+ ms      Per-ball send delay
    }

    // ── Compute top/bottom RPMs on demand (NOT stored) ────────────────────
    getRPMs() {
        const baseSpeed  = 970 + (630.5 * this.speed);
        const spinFactor = 342 * this.spin;
        let top, bot;
        if (this.type === 'top') {
            top = baseSpeed + spinFactor;
            bot = baseSpeed - spinFactor;
        } else {
            top = baseSpeed - spinFactor;
            bot = baseSpeed + spinFactor;
        }
        return {
            top: Math.round(clamp(top, RPM_MIN, RPM_MAX)),
            bot: Math.round(clamp(bot, RPM_MIN, RPM_MAX)),
        };
    }

    // ── Reverse-calculate speed/spin/type from given RPMs (legacy) ────────
    reverseCalc(top, bot) {
        this.type = top >= bot ? 'top' : 'back';
        const baseSpeed = (top + bot) / 2;
        const speedRaw  = (baseSpeed - 970) / 630.5;
        const diff      = Math.abs(top - bot) / 2;
        const spinRaw   = diff / 342;
        this.speed = Math.round(speedRaw * 2) / 2;
        this.spin  = Math.round(spinRaw * 2) / 2;
    }

    // ── Factory: create from legacy positional array ──────────────────────
    static fromArray(arr) {
        if (!arr || !Array.isArray(arr)) return null;
        const ball = new Ball({
            height:    arr[2],
            drop:      arr[3],
            frequency: arr[4],
            reps:      arr[5],
            speed:     arr[7],
            spin:      arr[8],
            type:      arr[9] ?? 'top',
            scatter:   arr[10] ?? 0,
            delay:     arr[11] ?? 0,
        });
        // If abstract values missing, derive from legacy RPMs at [0] and [1]
        if (ball.speed === undefined || ball.speed === null) {
            ball.reverseCalc(arr[0] ?? 2200, arr[1] ?? 2200);
        }
        return ball;
    }

    // ── Ensure speed/spin/type are populated ──────────────────────────────
    ensureMeta() {
        if (this.speed === undefined || this.speed === null) this.speed = 2;
        if (this.spin === undefined || this.spin === null) this.spin = 2;
        if (this.type === undefined || this.type === null) this.type = 'top';
    }

    // ── Clamp all fields to valid ranges ──────────────────────────────────
    clamp() {
        const maxSpin = SPIN_LIMITS[this.speed?.toString()] ?? 10;
        if (this.spin > maxSpin) this.spin = maxSpin;

        this.height    = clamp(this.height,    -50, 100);
        this.drop      = clamp(this.drop,      -10,  10);
        this.frequency = clamp(this.frequency,  30, 120);
        this.reps      = clamp(this.reps,        1, 200);
        this.speed     = clamp(this.speed,       0,  10);
        this.spin      = clamp(this.spin,        0,  10);

        if (Math.abs(this.drop) + this.scatter > 10) {
            this.scatter = clamp(10 - Math.abs(this.drop), 0, 10);
        }
        this.scatter = clamp(this.scatter, 0, 10);
        this.delay   = clamp(this.delay ?? 0, 0, 10000);
    }

    clone() {
        return new Ball({ ...this });
    }

    toJSON() {
        return {
            height:    this.height,
            drop:      this.drop,
            frequency: this.frequency,
            reps:      this.reps,
            speed:     this.speed,
            spin:      this.spin,
            type:      this.type,
            scatter:   this.scatter,
            delay:     this.delay,
        };
    }

    static fromJSON(json) {
        return new Ball(json);
    }
}
