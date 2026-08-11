// ─── Ball Model ───────────────────────────────────────────────────────────
// Single ball configuration. JSON serialization uses named fields.

import { RPM_MIN, RPM_MAX, SPIN_LIMITS } from '../constants.js';
import { clamp } from './helpers.js';

export class Ball {
    constructor({
        topRPM       = 2200,
        bottomRPM    = 2200,
        height       = 50,
        drop         = 0,
        frequency    = 50,
        reps         = 1,
        side         = 1,
        speed        = 2,
        spin         = 2,
        type         = 'top',
        scatter      = 0,
        delay        = 0,
    } = {}) {
        this.topRPM    = topRPM;       // int  400–7500   Top motor RPM
        this.bottomRPM = bottomRPM;    // int  400–7500   Bottom motor RPM
        this.height    = height;       // int  -50..100   Launch height
        this.drop      = drop;         // num  -10..10    Landing position offset (0.5 steps)
        this.frequency = frequency;    // int  30–120     Balls per minute (BPM)
        this.reps      = reps;         // int  1–200      Repetitions
        this.side      = side;         // 0|1             1=active, 0=inactive
        this.speed     = speed;        // num  0–10       Abstract speed level
        this.spin      = spin;         // num  0–10       Spin intensity
        this.type      = type;         // 'top'|'back'    Spin direction
        this.scatter   = scatter;      // num  0–10       Random drop variation
        this.delay     = delay;        // int  0+ ms      Per-ball send delay
    }

    // ── Factory: create from legacy positional array ──────────────────────
    static fromArray(arr) {
        if (!arr || !Array.isArray(arr)) return null;
        return new Ball({
            topRPM:    arr[0],
            bottomRPM: arr[1],
            height:    arr[2],
            drop:      arr[3],
            frequency: arr[4],
            reps:      arr[5],
            side:      arr[6] ?? 1,
            speed:     arr[7],
            spin:      arr[8],
            type:      arr[9] ?? 'top',
            scatter:   arr[10] ?? 0,
            delay:     arr[11] ?? 0,
        });
    }

    // ── Convert to legacy positional array (for Bluetooth / internal compat) ─
    toArray() {
        return [
            this.topRPM,
            this.bottomRPM,
            this.height,
            this.drop,
            this.frequency,
            this.reps,
            this.side,
            this.speed,
            this.spin,
            this.type,
            this.scatter,
            this.delay,
        ];
    }

    // ── Recalculate RPMs from speed/spin/type ─────────────────────────────
    recalcRPMs() {
        const baseSpeed = 970 + (630.5 * this.speed);
        const spinFactor = 342 * this.spin;
        if (this.type === 'top') {
            this.topRPM    = Math.round(clamp(baseSpeed + spinFactor, RPM_MIN, RPM_MAX));
            this.bottomRPM = Math.round(clamp(baseSpeed - spinFactor, RPM_MIN, RPM_MAX));
        } else {
            this.topRPM    = Math.round(clamp(baseSpeed - spinFactor, RPM_MIN, RPM_MAX));
            this.bottomRPM = Math.round(clamp(baseSpeed + spinFactor, RPM_MIN, RPM_MAX));
        }
    }

    // ── Reverse-calculate speed/spin/type from RPMs ───────────────────────
    reverseCalc() {
        this.type = this.topRPM >= this.bottomRPM ? 'top' : 'back';
        const baseSpeed = (this.topRPM + this.bottomRPM) / 2;
        const speedRaw  = (baseSpeed - 970) / 630.5;
        const diff      = Math.abs(this.topRPM - this.bottomRPM) / 2;
        const spinRaw   = diff / 342;
        this.speed = Math.round(speedRaw * 2) / 2;
        this.spin  = Math.round(spinRaw * 2) / 2;
    }

    // ── Ensure speed/spin/type are populated (reverse-calc if missing) ────
    ensureMeta() {
        if (this.speed === undefined || this.speed === null) {
            this.reverseCalc();
        }
    }

    // ── Clamp all fields to valid ranges ──────────────────────────────────
    clamp() {
        const maxSpin = SPIN_LIMITS[this.speed?.toString()] ?? 10;
        if (this.spin > maxSpin) this.spin = maxSpin;

        this.recalcRPMs();

        this.height    = clamp(this.height,    -50, 100);
        this.drop      = clamp(this.drop,      -10,  10);
        this.frequency = clamp(this.frequency,  30, 120);
        this.reps      = clamp(this.reps,        1, 200);
        this.side      = this.side === 1 ? 1 : 0;
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
            topRPM:    this.topRPM,
            bottomRPM: this.bottomRPM,
            height:    this.height,
            drop:      this.drop,
            frequency: this.frequency,
            reps:      this.reps,
            side:      this.side,
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
