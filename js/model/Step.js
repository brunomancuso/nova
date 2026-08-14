// ─── Step Model ───────────────────────────────────────────────────────────
// A Step is one launch position in a drill. It holds an ordered list of
// candidate Balls, but the robot fires exactly ONE ball per step:
//   - 1 ball   → single step: that ball fires on every rep.
//   - >1 balls → variant step: one ball is picked at random each rep.
//   - 0 balls  → empty step.

import { Ball } from './Ball.js';

export class Step {
    constructor({ balls = [] } = {}) {
        this.balls = balls;
    }

    get isVariant() { return this.balls.length > 1; }
    get isSingle()  { return this.balls.length === 1; }
    get isEmpty()   { return this.balls.length === 0; }

    /** Resolve to a single Ball for this rep (variant = random pick). */
    resolve() {
        if (this.balls.length === 0) return null;
        return this.balls[Math.floor(Math.random() * this.balls.length)];
    }

    clone() {
        return new Step({ balls: this.balls.map(b => b.clone()) });
    }

    /** All balls in this step, in order (for iteration). */
    allBalls() {
        return [...this.balls];
    }

    toJSON() {
        return { balls: this.balls.map(b => b.toJSON()) };
    }

    static fromJSON(json) {
        const balls = (json?.balls || []).map(b => Ball.fromJSON(b));
        return new Step({ balls });
    }
}
