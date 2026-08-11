// ─── Step Model ───────────────────────────────────────────────────────────
// A Step is one position in a drill. Two modes (mutually exclusive):
//   1. variants: Ball[] — pool of candidates, one randomly chosen each rep.
//   2. ball:     Ball   — a single fixed ball, fires every rep.

import { Ball } from './Ball.js';

export class Step {
    constructor({
        variants = [],   // Ball[] — candidate balls, pick one randomly
        ball     = null, // Ball   — single fixed ball
    } = {}) {
        this.variants = variants;
        this.ball     = ball;
    }

    get isVariant() { return this.variants.length > 0; }
    get isSingle()  { return !this.isVariant && this.ball !== null; }
    get isEmpty()   { return !this.isVariant && !this.isSingle; }

    /** Resolve to a single Ball for this rep (variants = random pick) */
    resolve() {
        if (this.isVariant) {
            return this.variants[Math.floor(Math.random() * this.variants.length)];
        }
        return this.ball;
    }

    clone() {
        return new Step({
            variants: this.variants.map(b => b.clone()),
            ball:     this.ball ? this.ball.clone() : null,
        });
    }

    /** All balls in this step (for iteration) */
    allBalls() {
        const list = [...this.variants];
        if (this.ball) list.push(this.ball);
        return list;
    }

    toJSON() {
        return {
            variants: this.variants.map(b => b.toJSON()),
            ball:     this.ball ? this.ball.toJSON() : null,
        };
    }

    static fromJSON(json) {
        return new Step({
            variants: (json.variants || []).map(b => Ball.fromJSON(b)),
            ball:     json.ball ? Ball.fromJSON(json.ball) : null,
        });
    }

    /** Legacy: Ball[][] → Step */
    static fromLegacy(arr) {
        if (arr.length === 1) {
            return new Step({ ball: arr[0] instanceof Ball ? arr[0] : Ball.fromArray(arr[0]) });
        }
        return new Step({ variants: arr.map(b => b instanceof Ball ? b : Ball.fromArray(b)) });
    }
}
