// ─── Drill Store ──────────────────────────────────────────────────────────
// Flat drill storage grouped by category A/B/C.
//   dataA: [Drill, Drill, ...]
//   dataB: [Drill, ...]
//   dataC: [Drill, ...]

import { Drill } from './Drill.js';
import { Step } from './Step.js';
import { Ball } from './Ball.js';

export class DrillStore {
    constructor({ dataA = [], dataB = [], dataC = [] } = {}) {
        this.dataA = dataA;
        this.dataB = dataB;
        this.dataC = dataC;
    }

    static CATS = ['dataA', 'dataB', 'dataC'];

    // ── Access ────────────────────────────────────────────────────────────

    get(cat)              { return this[cat]; }
    getDrill(cat, index)  { return this[cat]?.[index] ?? null; }
    findByName(cat, name) { return this[cat]?.find(d => d.name === name) ?? null; }
    count(cat)            { return this[cat]?.length ?? 0; }
    setCat(cat, arr)      { this[cat] = arr; }

    // ── Mutate ────────────────────────────────────────────────────────────

    add(cat, drill) {
        this[cat].push(drill);
        return drill;
    }

    remove(cat, index) {
        return this[cat].splice(index, 1)[0] ?? null;
    }

    swap(cat, i, j) {
        const arr = this[cat];
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    // ── Serialization ─────────────────────────────────────────────────────

    toJSON() {
        return {
            dataA: this.dataA.map(d => d.toJSON()),
            dataB: this.dataB.map(d => d.toJSON()),
            dataC: this.dataC.map(d => d.toJSON()),
        };
    }

    static fromJSON(json) {
        const opts = {};
        for (const cat of DrillStore.CATS) {
            opts[cat] = (json[cat] || []).map(d => Drill.fromJSON(d));
        }
        return new DrillStore(opts);
    }

    // ── Migration from old pointer format ─────────────────────────────────

    static fromLegacy(legacy) {
        const pointers = legacy.customData || {};
        const data     = legacy.customDrillData || {};
        const catMap   = { 'custom-a': 'dataA', 'custom-b': 'dataB', 'custom-c': 'dataC' };
        const opts     = { dataA: [], dataB: [], dataC: [] };

        for (const [oldCat, newCat] of Object.entries(catMap)) {
            const list = pointers[oldCat] || [];
            for (const ptr of list) {
                const drillData = data[ptr.key];
                if (!drillData) continue;
                const steps = (drillData.steps || []).map(s =>
                    s.variants !== undefined || s.ball !== undefined
                        ? Step.fromJSON(s)
                        : Step.fromLegacy(s)
                );
                opts[newCat].push(new Drill(ptr.name, {
                    steps,
                    random: !!drillData.random,
                }));
            }
        }
        return new DrillStore(opts);
    }
}
