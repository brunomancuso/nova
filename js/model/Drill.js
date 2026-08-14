// ─── Drill Model ──────────────────────────────────────────────────────────

import { Step } from './Step.js';

export class Drill {
    constructor(name = '', {
        steps  = [],     // Step[]
        random = false,
    } = {}) {
        this.name   = name;
        this.steps  = steps;
        this.random = random;
    }

    clone() {
        return new Drill(this.name, {
            steps:  this.steps.map(s => s.clone()),
            random: this.random,
        });
    }

    toJSON() {
        return {
            name:   this.name,
            steps:  this.steps.map(s => s.toJSON()),
            random: this.random,
        };
    }

    static fromJSON(json) {
        return new Drill(json.name || '', {
            steps:  (json.steps || []).map(s => Step.fromJSON(s)),
            random: !!json.random,
        });
    }
}
