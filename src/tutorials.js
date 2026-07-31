// ---------------------------------------------------------------------------
// Guided tutorial scripts + the pure objective tracker that runs them.
//
// A script is an ordered list of steps. Each step completes off real gameplay
// events (no timers): the engine feeds events in and the tracker ticks them
// off. Step shapes:
//   { text, on: 'jump'|'doubleJump'|'dash'|'land'|'cast'|'dummyHit',
//     when?(game, data, tracker),      // extra filter
//     count?: n,                        // need n qualifying events
//     sum?(data) + target: n,           // accumulate (e.g. total damage)
//     two?: { slot, window, n? } }      // distinct dummies hit by one cast
//   { text, poll(game, tracker) }       // checked every frame instead
//
// 'cast' events fire for every ability use ({slot, power}); power >= 0.99
// means fully charged. The tracker remembers the latest cast so damage that
// lands during an ability can be attributed to it (castWithin).
// ---------------------------------------------------------------------------

// damage landed within `window` seconds of casting `slot`
const afterCast = (slot, window) => (g, d, T) => T.castWithin(slot, window);
// as above, but the cast must have been fully charged
const afterFullCast = (slot, window) => (g, d, T) =>
  T.castWithin(slot, window) && T.casts[slot].power >= 0.99;

export const TUTORIAL_SCRIPTS = {
  basics: {
    title: 'BASICS', classId: 'mage',
    steps: [
      { text: 'Move around — WASD', poll: (g) => g.player.vel.lengthSq() > 9 },
      { text: 'Jump — SPACE', on: 'jump' },
      { text: 'Double jump — SPACE again in mid-air', on: 'doubleJump' },
      // grounded flips false before the dash event fires, so detect an AIR
      // dash by its longer reach (0.28s vs 0.18s on the ground)
      { text: 'Air dash 3 times — SHIFT in mid-air', on: 'dash', when: (g) => g.player.dashLen > 0.2, count: 3 },
      { text: 'Hit a dummy with your attack — LMB', on: 'dummyHit' },
      { text: 'HOLD Q until it flashes ◈, then release', on: 'cast', when: (g, d) => d.slot === 'Q' && d.power >= 0.99 },
      { text: 'Deal 100 total damage to the dummies', on: 'dummyHit', sum: (d) => d.dmg, target: 100 },
    ],
  },

  mage: {
    title: 'ARCANE MAGE', classId: 'mage',
    steps: [
      { text: 'Firebolt a dummy — LMB', on: 'dummyHit' },
      { text: 'Fully charge ARCANE BEAM ◈ (hold Q) and lance a dummy', on: 'dummyHit', when: afterFullCast('Q', 1.5) },
      { text: 'Plant a RIFT ANCHOR (E)… then E again to snap back', on: 'cast', when: (g, d) => d.slot === 'E', count: 2 },
      { text: 'Call a METEOR (R) down onto a dummy', on: 'dummyHit', when: afterCast('R', 4) },
      { text: 'FROST NOVA (F) right next to a dummy', on: 'dummyHit', when: afterCast('F', 1.2) },
      { text: 'Put it together: 150 total damage', on: 'dummyHit', sum: (d) => d.dmg, target: 150 },
    ],
  },

  brawler: {
    title: 'IRON BRAWLER', classId: 'brawler',
    steps: [
      { text: 'HAYMAKER — punch a dummy 3 times (LMB)', on: 'dummyHit', count: 3 },
      { text: 'ROCKET CHARGE (Q) — launch yourself into a dummy', on: 'dummyHit', when: afterCast('Q', 2.5) },
      { text: 'METEOR SLAM (E) — jump first, then crash onto a dummy', on: 'dummyHit', when: afterCast('E', 3) },
      { text: 'HUNDRED FISTS (R) — trap a dummy in the flurry (4 hits)', on: 'dummyHit', when: afterCast('R', 4), count: 4 },
      { text: 'SHOCKWAVE (F) — smash TWO dummies with one wave', on: 'dummyHit', two: { slot: 'F', window: 2.5 } },
    ],
  },

  reaver: {
    title: 'STORM REAVER', classId: 'reaver',
    steps: [
      { text: 'SKYPIERCER — spear a dummy (LMB)', on: 'dummyHit' },
      { text: 'STORM LUNGE (Q) — skewer a dummy mid-dash', on: 'dummyHit', when: afterCast('Q', 1.8) },
      { text: 'THUNDERCLAP (E) — stun TWO dummies with one crack', on: 'dummyHit', two: { slot: 'E', window: 1.2 } },
      { text: 'CYCLONE (R) — ride your whirlwind into the sky', on: 'cast', when: (g, d) => d.slot === 'R' },
      { text: 'SLIPSTREAM (F) — fly through a dummy and drag it', on: 'dummyHit', when: afterCast('F', 4.5) },
    ],
  },

  sorcerer: {
    title: 'SORCERER', classId: 'sorcerer',
    steps: [
      { text: 'CURSED FISTS — strike a dummy 3 times (LMB)', on: 'dummyHit', count: 3 },
      { text: 'RED (Q) — snipe a dummy with the bolt', on: 'dummyHit', when: afterCast('Q', 1.5) },
      { text: 'BLUE (E) — let the orb drag a dummy in', on: 'dummyHit', when: afterCast('E', 6.5) },
      { text: 'PURPLE NUKE (R) — channel it, erase a dummy', on: 'dummyHit', when: afterCast('R', 6.5) },
      { text: 'BLACK FLASH (F) — point-blank detonation', on: 'dummyHit', when: afterCast('F', 1.2) },
      { text: 'Cursed rampage: 150 total damage', on: 'dummyHit', sum: (d) => d.dmg, target: 150 },
    ],
  },

  assassin: {
    title: 'SHADOW ASSASSIN', classId: 'assassin',
    steps: [
      { text: 'TWIN FANGS — poison a dummy (LMB)', on: 'dummyHit', when: (g, d) => !!(d.opts && d.opts.poison) },
      { text: 'SHADOWSTEP (Q) — slice through a dummy and snap back', on: 'dummyHit', when: afterCast('Q', 2.5) },
      { text: 'VOID SLASH (E) — cut TWO dummies with one crescent', on: 'dummyHit', two: { slot: 'E', window: 1.5 } },
      { text: 'DEATH MARK (R) — mark a dummy for death', on: 'cast', when: (g, d) => d.slot === 'R' },
      { text: 'EVISCERATE (F) — land the full shadow combo', on: 'dummyHit', when: afterCast('F', 3) },
    ],
  },

  gambler: {
    title: 'THE GAMBLER', classId: 'gambler',
    steps: [
      { text: 'LOADED DICE — hit a dummy (LMB)', on: 'dummyHit' },
      { text: 'PULL THE LEVER (Q) — spin the machine', on: 'cast', when: (g, d) => d.slot === 'Q' },
      {
        text: 'Keep spinning — land a JACKPOT (three in a row!)',
        poll: (g) => {
          const s = g.combat && g.combat.state;
          return !!(s && (s.minigunT > 0 || s.reaperT > 0 || s.cobra || s.purpleT > 0 || s.loadedShot === 'nuke'));
        },
      },
      { text: 'Ride the hot streak: 200 total damage', on: 'dummyHit', sum: (d) => d.dmg, target: 200 },
    ],
  },
};

// ---------------------------------------------------------------------------
// ObjectiveTracker: pure step-progress logic (no DOM), tested headless.
// ---------------------------------------------------------------------------
export class ObjectiveTracker {
  constructor(script, game, cbs = {}) {
    this.script = script;
    this.g = game;
    this.cbs = cbs;          // { onRender, onStepDone, onComplete }
    this.idx = 0;
    // per-slot cast records: basic-attack autofire between an ability cast
    // and its delayed damage (meteor, orbs) must not steal the attribution
    this.casts = {};         // slot -> { t, power }
    this._resetStep();
  }

  get step() { return this.script.steps[this.idx] || null; }
  get done() { return this.idx >= this.script.steps.length; }

  castWithin(slot, window) {
    const c = this.casts[slot];
    return !!c && this.g.simTime - c.t <= window;
  }

  // "2/3"-style counter for the active step, or null
  progressText() {
    const s = this.step;
    if (!s) return null;
    if (s.two) return `${this.hitSet.size}/${s.two.n || 2}`;
    if (s.count) return `${this.n}/${s.count}`;
    if (s.sum) return `${Math.min(Math.round(this.acc), s.target)}/${s.target}`;
    return null;
  }

  _resetStep() {
    this.n = 0;
    this.acc = 0;
    this.hitSet = new Set();
    this._twoCastT = null;
  }

  _complete() {
    const finished = this.step;
    this.idx++;
    this._resetStep();
    this.cbs.onStepDone?.(finished, this.idx - 1);
    if (this.done) this.cbs.onComplete?.();
  }

  onEvent(type, data = {}) {
    if (this.done) return;
    if (type === 'cast') {
      this.casts[data.slot] = { t: this.g.simTime, power: data.power || 0 };
    }
    const s = this.step;
    if (!s || s.on !== type) return;
    if (s.when && !s.when(this.g, data, this)) return;
    if (s.two) {
      if (!this.castWithin(s.two.slot, s.two.window)) return;
      const castT = this.casts[s.two.slot].t;
      if (this._twoCastT !== castT) {             // each new cast starts fresh
        this.hitSet.clear();
        this._twoCastT = castT;
      }
      this.hitSet.add(data.dummy);
      if (this.hitSet.size >= (s.two.n || 2)) this._complete();
      else this.cbs.onRender?.();
      return;
    }
    if (s.count) {
      this.n++;
      if (this.n >= s.count) this._complete();
      else this.cbs.onRender?.();
      return;
    }
    if (s.sum) {
      this.acc += s.sum(data);
      if (this.acc >= s.target) this._complete();
      else this.cbs.onRender?.();
      return;
    }
    this._complete();
  }

  // per-frame: poll steps only
  update() {
    if (this.done) return;
    const s = this.step;
    if (s.poll && s.poll(this.g, this)) this._complete();
  }
}
