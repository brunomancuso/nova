// ─── Drill Model ──────────────────────────────────────────────────────────

import { Step } from './Step.js';

export class Drill {
    constructor(name = '', {
        steps  = [],     // Step[]
        random = false,
        disableScatter = false,
        deltaSpeed = 0,
    } = {}) {
        this.name   = name;
        this.steps  = steps;
        this.random = random;
        this.disableScatter = disableScatter;
        this.deltaSpeed = deltaSpeed;
    }

    clone() {
        return new Drill(this.name, {
            steps:  this.steps.map(s => s.clone()),
            random: this.random,
            disableScatter: this.disableScatter,
            deltaSpeed: this.deltaSpeed,
        });
    }

    toJSON() {
        return {
            name:   this.name,
            steps:  this.steps.map(s => s.toJSON()),
            random: this.random,
            disableScatter: this.disableScatter,
            deltaSpeed: this.deltaSpeed,
        };
    }

    static fromJSON(json) {
        return new Drill(json.name || '', {
            steps:  (json.steps || []).map(s => Step.fromJSON(s)),
            random: !!json.random,
            disableScatter: !!json.disableScatter,
            deltaSpeed: json.deltaSpeed ?? 0,
        });
    }
}
