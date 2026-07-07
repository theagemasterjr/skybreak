// Persistent stats in localStorage: best wave per class, kills, runs.

const KEY = 'skybreak-stats-v1';

export class Stats {
  constructor() {
    this.data = { bestWave: {}, totalKills: 0, runs: 0 };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...this.data, ...JSON.parse(raw) };
    } catch { /* fresh start */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* private mode */ }
  }

  bestFor(classId) { return this.data.bestWave[classId] || 0; }
  bestOverall() { return Math.max(0, ...Object.values(this.data.bestWave)); }

  addKill() { this.data.totalKills++; }

  startRun() { this.data.runs++; this.save(); }

  // returns true if this run set a new best
  endRun(classId, wave) {
    const best = this.bestFor(classId);
    const isNewBest = wave > best;
    if (isNewBest) this.data.bestWave[classId] = wave;
    this.save();
    return isNewBest;
  }
}
