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

    /** Merge legacy level-keys + Ball[][] into Step[] */
    static fromLegacy(name, legacyData) {
        const allSteps = [];
        for (let lvl = 1; lvl <= 3; lvl++) {
            const raw = legacyData[lvl];
            if (raw && Array.isArray(raw)) {
                for (const stepArr of raw) {
                    allSteps.push(Step.fromLegacy(stepArr));
                }
            }
        }
        if (allSteps.length === 0 && legacyData.steps && Array.isArray(legacyData.steps)) {
            for (const stepArr of legacyData.steps) {
                allSteps.push(Step.fromLegacy(stepArr));
            }
        }
        return new Drill(name, {
            steps:  allSteps,
            random: !!legacyData.random,
        });
    }
}
