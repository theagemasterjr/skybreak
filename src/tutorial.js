import * as THREE from 'three';
import { TrainingDummy } from './dummy.js';
import { DUMMY_SPOTS } from './maps/training.js';
import { TUTORIAL_SCRIPTS, ObjectiveTracker } from './tutorials.js';

// ---------------------------------------------------------------------------
// Tutorial: guided objective mode on the training grounds. A script from
// tutorials.js drives a checklist card; steps tick off only when the player
// actually performs them (events tapped via game.emitTut). scriptId 'free'
// skips objectives entirely — just dummies and freedom.
// Dummies live in game.enemies, so real attack/ability code hits them.
// ---------------------------------------------------------------------------

export class Tutorial {
  constructor(game, uiRoot) {
    this.game = game;
    this.dummies = [];
    this.tracker = null;

    if (!document.getElementById('tutorial-style')) {
      const style = document.createElement('style');
      style.id = 'tutorial-style';
      style.textContent = `
        #tutorial-overlay { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 0.25s; }
        #tutorial-overlay.active { opacity: 1; }
        #tutorial-card {
          position: absolute; left: 50%; bottom: 42px; transform: translateX(-50%);
          background: var(--ink-80, rgba(13,16,34,0.8)); border: 1px solid rgba(255,255,255,0.12);
          border-top: 2px solid var(--gold, #ffd76a); padding: 12px 26px 14px; min-width: 420px;
          text-align: center; font-family: "Segoe UI", system-ui, sans-serif; color: var(--text, #f6eee0);
        }
        #tutorial-card h3 { font-size: 0.8rem; letter-spacing: 0.1em; color: var(--gold, #ffd76a); margin-bottom: 5px; }
        #tutorial-done { font-size: 0.78rem; color: #7fae7f; line-height: 1.5; }
        #tutorial-done div { opacity: 0.85; }
        #tutorial-step { font-size: 1.0rem; color: var(--text, #f6eee0); margin-top: 4px; }
        #tutorial-step b { color: var(--gold, #ffd76a); margin-left: 8px; }
        #tutorial-step.complete { color: #9fe8a8; }
        #tutorial-card .flashline { animation: tut-flash 0.5s; }
        @keyframes tut-flash { 0% { text-shadow: 0 0 18px #ffd76a; } 100% { text-shadow: none; } }
        #tutorial-exit {
          position: absolute; top: 18px; right: 18px; pointer-events: auto; cursor: pointer;
          background: rgba(13,16,34,0.8); border: 1px solid rgba(255,255,255,0.16); color: var(--text, #f6eee0);
          font: 700 0.78rem "Segoe UI", system-ui, sans-serif; letter-spacing: 0.06em;
          padding: 9px 16px;
        }
        #tutorial-exit:hover { background: rgba(255,255,255,0.12); }
      `;
      document.head.appendChild(style);
    }

    this.el = document.createElement('div');
    this.el.id = 'tutorial-overlay';
    this.el.innerHTML = `
      <div id="tutorial-card">
        <h3></h3>
        <div id="tutorial-done"></div>
        <p id="tutorial-step"></p>
      </div>
      <button id="tutorial-exit">EXIT TUTORIAL</button>
    `;
    uiRoot.appendChild(this.el);
    this.cardTitle = this.el.querySelector('h3');
    this.doneEl = this.el.querySelector('#tutorial-done');
    this.stepEl = this.el.querySelector('#tutorial-step');
    this.el.querySelector('#tutorial-exit').addEventListener('click', () => this.game.toMenu());
  }

  start(scriptId = 'basics') {
    const g = this.game;
    this.el.classList.add('active');

    this.dummies = DUMMY_SPOTS.map(([x, z]) => {
      const y = g.world.groundHeightBelow(x, z, 30, 0, 1) ?? 0;
      return new TrainingDummy(g, new THREE.Vector3(x, y, z), 'PRACTICE DUMMY');
    });
    for (const d of this.dummies) g.enemies.push(d);

    const script = TUTORIAL_SCRIPTS[scriptId] || null;
    this.script = script;
    this.tracker = script
      ? new ObjectiveTracker(script, g, {
          onRender: () => this._render(),
          onStepDone: () => this._stepDoneFx(),
          onComplete: () => this._completeFx(),
        })
      : null;
    this._render();
  }

  // real gameplay events (jumps, dashes, casts, dummy hits) route here
  onEvent(type, data) {
    this.tracker?.onEvent(type, data);
  }

  _render() {
    const t = this.tracker;
    if (!t) {
      this.cardTitle.textContent = 'FREE PRACTICE';
      this.doneEl.innerHTML = '';
      this.stepEl.innerHTML = 'Hit the dummies, try combos — ESC any time to leave';
      return;
    }
    this.cardTitle.textContent = `${this.script.title} — TUTORIAL`;
    // last few completed steps as a ✓ trail
    const doneSteps = this.script.steps.slice(0, t.idx).slice(-3);
    this.doneEl.innerHTML = doneSteps.map((s) => `<div>✓ ${s.text}</div>`).join('');
    if (t.done) {
      this.stepEl.className = 'complete flashline';
      this.stepEl.innerHTML = '✦ ALL OBJECTIVES COMPLETE — the grounds are yours';
    } else {
      const prog = t.progressText();
      this.stepEl.className = '';
      this.stepEl.innerHTML = `${t.step.text}${prog ? ` <b>${prog}</b>` : ''}`;
    }
  }

  _stepDoneFx() {
    const g = this.game;
    g.hud?.flash('rgba(255, 215, 106, 0.14)', 0.3);
    g.audio?.play('chargeFull');
    this._render();
    // retrigger the flash animation on the step line
    this.stepEl.classList.remove('flashline');
    void this.stepEl.offsetWidth;
    this.stepEl.classList.add('flashline');
  }

  _completeFx() {
    const g = this.game;
    g.hud?.announce('TUTORIAL COMPLETE', '');
    g.audio?.play('waveClear');
    const c = g.player.position.clone(); c.y += 1.2;
    g.effects.burst(c, { count: 30, color: 0xffd76a, color2: 0xfff3c8, speed: 8, size: 0.3, life: 0.6, gravity: -2 });
    g.effects.ring(c, { color: 0xffd76a, endRadius: 5, life: 0.6 });
    this._render();
  }

  // called every frame while game.state === 'tutorial'
  update(dt) {
    this.tracker?.update();
    // gentle passive heal so falling off the edge never feels punishing
    const p = this.game.player;
    if (p.health < p.maxHealth) p.heal(dt * 40);
  }

  exit() {
    this.el.classList.remove('active');
    this.dummies.length = 0;   // actual disposal happens via game._clearBattlefield()
    this.tracker = null;
  }
}
