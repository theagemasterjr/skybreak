// ---------------------------------------------------------------------------
// GameAudio: fully procedural WebAudio sound. No asset files — every effect
// is synthesized from oscillators and filtered noise. Includes a soft wind +
// pad ambience. The context resumes on the first user gesture.
// ---------------------------------------------------------------------------

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.lastPlay = {};       // throttle per-sound
    this.enabled = true;

    const boot = () => {
      this._init();
      window.removeEventListener('pointerdown', boot);
      window.removeEventListener('keydown', boot);
    };
    window.addEventListener('pointerdown', boot);
    window.addEventListener('keydown', boot);
  }

  _init() {
    if (this.ctx) { this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this._noiseBuffer = this._makeNoise();
    this._startAmbience();
  }

  _makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ---- building blocks ----
  _tone({ wave = 'sine', f = 440, fEnd = null, dur = 0.15, gain = 0.15, attack = 0.005, delay = 0 }) {
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(f, t0);
    if (fEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, fEnd), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  _noise({ dur = 0.2, gain = 0.12, filter = 1800, filterEnd = null, type = 'lowpass', delay = 0, q = 0.8 }) {
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const flt = this.ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(filter, t0);
    if (filterEnd !== null) flt.frequency.exponentialRampToValueAtTime(Math.max(40, filterEnd), t0 + dur);
    flt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(flt).connect(g).connect(this.master);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
  }

  _thump({ f = 90, dur = 0.25, gain = 0.3, delay = 0 }) {
    this._tone({ wave: 'sine', f: f * 2.2, fEnd: f * 0.5, dur, gain, delay });
    this._noise({ dur: dur * 0.7, gain: gain * 0.5, filter: 300, filterEnd: 90, delay });
  }

  _zap({ f = 900, dur = 0.1, gain = 0.12, delay = 0 }) {
    this._tone({ wave: 'square', f, fEnd: f * 0.4, dur, gain: gain * 0.7, delay });
    this._noise({ dur, gain, filter: 4200, filterEnd: 900, type: 'bandpass', q: 3, delay });
  }

  // ---- ambience: wind + low pad ----
  _startAmbience() {
    const t0 = this.ctx.currentTime;
    // wind: looped noise through a wandering lowpass
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 420;
    const g = this.ctx.createGain();
    g.gain.value = 0.045;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 200;
    lfo.connect(lfoGain).connect(flt.frequency);
    src.connect(flt).connect(g).connect(this.master);
    src.start(t0);
    lfo.start(t0);
    // pad: two soft detuned triangles, very quiet
    for (const [f, det] of [[110, 0], [165, 3]]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      osc.detune.value = det;
      const og = this.ctx.createGain();
      og.gain.value = 0.014;
      const padLfo = this.ctx.createOscillator();
      padLfo.frequency.value = 0.05 + f * 0.0001;
      const padLfoG = this.ctx.createGain();
      padLfoG.gain.value = 0.008;
      padLfo.connect(padLfoG).connect(og.gain);
      osc.connect(og).connect(this.master);
      osc.start(t0);
      padLfo.start(t0);
    }
  }

  play(name) {
    if (!this.ctx || !this.enabled) return;
    const now = performance.now();
    if (this.lastPlay[name] && now - this.lastPlay[name] < 45) return;
    this.lastPlay[name] = now;
    const S = SOUNDS[name];
    if (S) S(this);
  }
}

// ---- sound recipes ----
const SOUNDS = {
  // movement
  jump: (a) => a._noise({ dur: 0.09, gain: 0.05, filter: 900, filterEnd: 2200, type: 'bandpass' }),
  doubleJump: (a) => { a._tone({ wave: 'sine', f: 520, fEnd: 760, dur: 0.12, gain: 0.06 }); a._noise({ dur: 0.1, gain: 0.04, filter: 2000, type: 'bandpass' }); },
  land: (a) => a._thump({ f: 70, dur: 0.12, gain: 0.1 }),
  dash: (a) => a._noise({ dur: 0.22, gain: 0.14, filter: 3500, filterEnd: 500, type: 'bandpass', q: 1.2 }),

  // mage
  firebolt: (a) => { a._noise({ dur: 0.14, gain: 0.1, filter: 2400, filterEnd: 500, type: 'bandpass', q: 1.5 }); a._tone({ wave: 'sawtooth', f: 300, fEnd: 120, dur: 0.12, gain: 0.05 }); },
  beam: (a) => { a._tone({ wave: 'sawtooth', f: 1200, fEnd: 300, dur: 0.34, gain: 0.14 }); a._zap({ f: 1600, dur: 0.3, gain: 0.08 }); },
  blink: (a) => { a._tone({ wave: 'sine', f: 900, fEnd: 1800, dur: 0.16, gain: 0.09 }); a._noise({ dur: 0.14, gain: 0.06, filter: 5000, filterEnd: 1500, type: 'highpass' }); },
  meteorCall: (a) => a._tone({ wave: 'sine', f: 180, fEnd: 400, dur: 0.5, gain: 0.08 }),
  meteorHit: (a) => { a._thump({ f: 55, dur: 0.6, gain: 0.4 }); a._noise({ dur: 0.5, gain: 0.2, filter: 900, filterEnd: 120 }); },
  frost: (a) => { a._noise({ dur: 0.4, gain: 0.14, filter: 6000, filterEnd: 2000, type: 'highpass' }); a._tone({ wave: 'sine', f: 1400, fEnd: 500, dur: 0.35, gain: 0.06 }); },

  // brawler
  punchHit: (a) => a._thump({ f: 110, dur: 0.14, gain: 0.22 }),
  whoosh: (a) => a._noise({ dur: 0.12, gain: 0.07, filter: 1200, filterEnd: 300, type: 'bandpass' }),
  charge: (a) => a._noise({ dur: 0.3, gain: 0.16, filter: 500, filterEnd: 1800 }),
  slam: (a) => { a._thump({ f: 60, dur: 0.4, gain: 0.34 }); },
  buff: (a) => { a._tone({ wave: 'triangle', f: 400, fEnd: 800, dur: 0.3, gain: 0.09 }); a._tone({ wave: 'triangle', f: 600, fEnd: 1200, dur: 0.3, gain: 0.06, delay: 0.06 }); },

  // reaver
  zapShot: (a) => a._zap({ f: 1100, dur: 0.08, gain: 0.08 }),
  zap: (a) => a._zap({ f: 800, dur: 0.14, gain: 0.12 }),

  // warden
  slash: (a) => { a._noise({ dur: 0.1, gain: 0.1, filter: 3000, filterEnd: 900, type: 'bandpass', q: 2 }); a._thump({ f: 130, dur: 0.08, gain: 0.08 }); },
  pull: (a) => a._tone({ wave: 'sawtooth', f: 200, fEnd: 90, dur: 0.25, gain: 0.1 }),
  roar: (a) => { a._tone({ wave: 'sawtooth', f: 140, fEnd: 70, dur: 0.5, gain: 0.16 }); a._noise({ dur: 0.4, gain: 0.1, filter: 700, filterEnd: 200 }); },
  dome: (a) => a._tone({ wave: 'sine', f: 300, fEnd: 600, dur: 0.5, gain: 0.1 }),

  // assassin
  smoke: (a) => a._noise({ dur: 0.4, gain: 0.1, filter: 1500, filterEnd: 300 }),
  mark: (a) => a._tone({ wave: 'square', f: 1000, fEnd: 1400, dur: 0.12, gain: 0.05 }),
  eviscerate: (a) => { a._noise({ dur: 0.16, gain: 0.14, filter: 4500, filterEnd: 800, type: 'bandpass', q: 2 }); a._thump({ f: 90, dur: 0.2, gain: 0.16, delay: 0.03 }); },

  // charging
  chargeStart: (a) => a._tone({ wave: 'sine', f: 220, fEnd: 330, dur: 0.2, gain: 0.05 }),
  chargeFull: (a) => { a._tone({ wave: 'sine', f: 660, dur: 0.15, gain: 0.08 }); a._tone({ wave: 'sine', f: 990, dur: 0.2, gain: 0.06, delay: 0.05 }); },

  // enemies
  enemyShot: (a) => a._tone({ wave: 'sawtooth', f: 500, fEnd: 250, dur: 0.12, gain: 0.06 }),
  swipe: (a) => a._noise({ dur: 0.1, gain: 0.08, filter: 2500, filterEnd: 700, type: 'bandpass', q: 1.5 }),
  windup: (a) => a._tone({ wave: 'triangle', f: 260, fEnd: 380, dur: 0.25, gain: 0.05 }),
  fuse: (a) => a._tone({ wave: 'square', f: 700, fEnd: 1200, dur: 0.5, gain: 0.045 }),
  explosion: (a) => { a._thump({ f: 50, dur: 0.5, gain: 0.36 }); a._noise({ dur: 0.45, gain: 0.18, filter: 1200, filterEnd: 150 }); },
  enemyDeath: (a) => { a._tone({ wave: 'triangle', f: 500, fEnd: 150, dur: 0.2, gain: 0.08 }); a._noise({ dur: 0.15, gain: 0.05, filter: 2000, filterEnd: 400 }); },
  eliteDeath: (a) => { a._thump({ f: 70, dur: 0.4, gain: 0.25 }); a._tone({ wave: 'triangle', f: 400, fEnd: 100, dur: 0.45, gain: 0.1 }); },

  // player + flow
  playerHurt: (a) => { a._thump({ f: 120, dur: 0.15, gain: 0.16 }); a._tone({ wave: 'square', f: 220, fEnd: 140, dur: 0.12, gain: 0.05 }); },
  playerDeath: (a) => { a._tone({ wave: 'sawtooth', f: 300, fEnd: 60, dur: 1.1, gain: 0.16 }); a._thump({ f: 45, dur: 0.8, gain: 0.3, delay: 0.1 }); },
  runStart: (a) => { a._tone({ wave: 'triangle', f: 330, fEnd: 660, dur: 0.3, gain: 0.09 }); a._tone({ wave: 'triangle', f: 495, fEnd: 990, dur: 0.35, gain: 0.06, delay: 0.08 }); },
  waveStart: (a) => { a._tone({ wave: 'triangle', f: 392, dur: 0.18, gain: 0.09 }); a._tone({ wave: 'triangle', f: 523, dur: 0.22, gain: 0.09, delay: 0.14 }); },
  waveClear: (a) => { a._tone({ wave: 'triangle', f: 523, dur: 0.16, gain: 0.08 }); a._tone({ wave: 'triangle', f: 659, dur: 0.16, gain: 0.08, delay: 0.1 }); a._tone({ wave: 'triangle', f: 784, dur: 0.3, gain: 0.09, delay: 0.2 }); },
};
