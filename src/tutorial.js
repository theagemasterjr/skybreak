import * as THREE from 'three';
import { TrainingDummy } from './dummy.js';
import { DUMMY_SPOTS } from './maps/training.js';

// ---------------------------------------------------------------------------
// Tutorial: a lightweight practice mode on the training grounds. No waves, no
// death pressure — just movement, one class's basic combat, and stationary
// dummies to hit. Dummies live in game.enemies (the same array every hit-scan
// function in playerCombat.js reads), so real attack/ability code works on
// them unmodified.
// ---------------------------------------------------------------------------

const _v1 = new THREE.Vector3();

const STEPS = [
  { title: 'MOVE & JUMP', body: 'WASD to move · SPACE to jump (press again mid-air to double jump)' },
  { title: 'AIR DASH', body: 'SHIFT to dash — works on the ground or in the air, and refills over time' },
  { title: 'ATTACK & ABILITY', body: 'MOUSE to attack the dummies · Q for your ability (hold Q to charge it up)' },
  { title: 'HAVE AT IT', body: 'Hit the dummies to try combos. ESC or EXIT TUTORIAL any time to leave.' },
];

export class Tutorial {
  constructor(game, uiRoot) {
    this.game = game;
    this.dummies = [];
    this.t = 0;
    this.stepIdx = 0;

    if (!document.getElementById('tutorial-style')) {
      const style = document.createElement('style');
      style.id = 'tutorial-style';
      style.textContent = `
        #tutorial-overlay { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 0.25s; }
        #tutorial-overlay.active { opacity: 1; }
        #tutorial-card {
          position: absolute; left: 50%; bottom: 42px; transform: translateX(-50%);
          background: var(--ink-80, rgba(13,16,34,0.8)); border: 1px solid rgba(255,255,255,0.12);
          border-top: 2px solid var(--gold, #ffd76a); padding: 14px 26px; min-width: 380px;
          text-align: center; font-family: "Segoe UI", system-ui, sans-serif; color: var(--text, #f6eee0);
        }
        #tutorial-card h3 { font-size: 0.85rem; letter-spacing: 0.08em; color: var(--gold, #ffd76a); margin-bottom: 6px; }
        #tutorial-card p { font-size: 0.92rem; color: var(--text-dim, #c9bda8); }
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
      <div id="tutorial-card"><h3></h3><p></p></div>
      <button id="tutorial-exit">EXIT TUTORIAL</button>
    `;
    uiRoot.appendChild(this.el);
    this.cardTitle = this.el.querySelector('#tutorial-card h3');
    this.cardBody = this.el.querySelector('#tutorial-card p');
    this.el.querySelector('#tutorial-exit').addEventListener('click', () => this.game.toMenu());
  }

  start() {
    const g = this.game;
    this.t = 0;
    this.stepIdx = 0;
    this._renderStep();
    this.el.classList.add('active');

    this.dummies = DUMMY_SPOTS.map(([x, z]) => {
      const y = g.world.groundHeightBelow(x, z, 30, 0, 1) ?? 0;
      return new TrainingDummy(g, new THREE.Vector3(x, y, z), 'PRACTICE DUMMY');
    });
    for (const d of this.dummies) g.enemies.push(d);
  }

  _renderStep() {
    const s = STEPS[this.stepIdx];
    this.cardTitle.textContent = s.title;
    this.cardBody.textContent = s.body;
  }

  // called every frame while game.state === 'tutorial'
  update(dt) {
    this.t += dt;
    // advance the step prompt on a timer; the last step just stays up
    const nextAt = [0, 6, 12, 19][this.stepIdx + 1];
    if (nextAt !== undefined && this.t >= nextAt) {
      this.stepIdx++;
      this._renderStep();
    }
    // gentle passive heal so falling off the edge never feels punishing
    const p = this.game.player;
    if (p.health < p.maxHealth) p.heal(dt * 40);
  }

  exit() {
    this.el.classList.remove('active');
    this.dummies.length = 0;   // actual disposal happens via game._clearBattlefield()
  }
}
