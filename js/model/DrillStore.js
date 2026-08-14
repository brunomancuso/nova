// ─── Drill Store ──────────────────────────────────────────────────────────
// Flat drill storage grouped by category A/B/C.
//   dataA: [Drill, Drill, ...]
//   dataB: [Drill, ...]
//   dataC: [Drill, ...]

import { Drill } from './Drill.js';

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
}
