import * as THREE from 'three';
import { CLASSES, CLASS_LIST } from './classes.js';
import { ENEMY_TYPES, ENEMY_INFO } from './enemies.js';
import { MODEL_BUILDERS } from './enemyModels.js';

// ---------------------------------------------------------------------------
// Menus: main title, class select, pause, death, and codex screens.
// All sit over the live 3D world (the game keeps rendering behind a scrim).
// ---------------------------------------------------------------------------

const STAT_MAX = { hp: 170, speed: 13, dashes: 4 };

function diamonds(n, max = 5) {
  let s = '';
  for (let i = 0; i < max; i++) s += `<i class="${i < n ? 'on' : ''}"></i>`;
  return `<span class="diamonds">${s}</span>`;
}

export class Menus {
  constructor(game, root) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'menus';
    root.appendChild(this.el);
    this._buildMain();
    this._buildSelect();
    this._buildPause();
    this._buildDeath();
    this._buildCodex();
    this._buildMatch();
    this._buildDuelEnd();
    this._buildDuelPause();
    this.screens = {
      main: this.el.querySelector('#menu-main'),
      select: this.el.querySelector('#menu-select'),
      pause: this.el.querySelector('#menu-pause'),
      death: this.el.querySelector('#menu-death'),
      codex: this.el.querySelector('#menu-codex'),
      match: this.el.querySelector('#menu-match'),
      duelend: this.el.querySelector('#menu-duelend'),
      duelpause: this.el.querySelector('#menu-duelpause'),
    };
    this._codexFrom = 'main';   // screen to return to when the codex closes

    window.addEventListener('keydown', (e) => this._onKey(e));
  }

  _buildMain() {
    const s = document.createElement('div');
    s.id = 'menu-main';
    s.className = 'screen';
    s.innerHTML = `
      <div class="scrim"></div>
      <div class="menu-content">
        <h1 class="title">SKYBREAK</h1>
        <p class="subtitle">Endless war above the clouds</p>
        <button class="btn primary" id="btn-play">SINGLEPLAYER</button>
        <button class="btn duel" id="btn-duel">DUEL <span class="btn-tag">1v1 ONLINE</span></button>
        <button class="btn" id="btn-tutorial">TUTORIAL</button>
        <button class="btn" id="btn-codex-main">CODEX</button>
        <div class="menu-stats" id="main-stats"></div>
        <div class="controls-hint">
          <span><b>WASD</b> move</span><span><b>SPACE</b> double&nbsp;jump</span>
          <span><b>SHIFT</b> air&nbsp;dash</span><span><b>MOUSE</b> attack</span>
          <span><b>Q&nbsp;E&nbsp;R&nbsp;F</b> abilities&nbsp;·&nbsp;hold&nbsp;to&nbsp;charge&nbsp;◈</span>
        </div>
      </div>
    `;
    this.el.appendChild(s);
    s.querySelector('#btn-play').addEventListener('click', () => this.game.showSelect());
    s.querySelector('#btn-duel').addEventListener('click', () => this.game.duel.startMatchmaking());
    s.querySelector('#btn-tutorial').addEventListener('click', () => this.game.startTutorial());
    s.querySelector('#btn-codex-main').addEventListener('click', () => this.openCodex('main'));
  }

  _buildSelect() {
    const s = document.createElement('div');
    s.id = 'menu-select';
    s.className = 'screen';
    let cols = '';
    CLASS_LIST.forEach((id, i) => {
      const c = CLASSES[id];
      const accent = '#' + c.color.toString(16).padStart(6, '0');
      const hpN = Math.round((c.stats.maxHealth / STAT_MAX.hp) * 5);
      const spN = Math.round((c.stats.walkSpeed / STAT_MAX.speed) * 5);
      const daN = Math.round((c.stats.maxDashes / STAT_MAX.dashes) * 5);
      const abilities = c.abilities.map((a) =>
        `<li><b>${a.slot}</b>${a.name}${a.chargeable ? ' <i class="chargeable">◈</i>' : ''}</li>`
      ).join('');
      cols += `
        <div class="class-col" data-class="${id}" style="--accent:${accent}">
          <div class="class-num">${i + 1}</div>
          <h2>${c.name}</h2>
          <p class="role">${c.role}</p>
          <p class="tagline">${c.tagline}</p>
          <div class="stat-rows">
            <div class="stat-row"><span>VITALITY</span>${diamonds(hpN)}</div>
            <div class="stat-row"><span>SPEED</span>${diamonds(spN)}</div>
            <div class="stat-row"><span>DASHES</span>${diamonds(daN)}</div>
          </div>
          <ul class="ability-list">
            <li><b>LMB</b>${c.basic.name}</li>
            ${abilities}
          </ul>
          <div class="class-best" data-best="${id}"></div>
          <button class="btn pick">FIGHT</button>
        </div>
      `;
    });
    s.innerHTML = `
      <div class="scrim"></div>
      <div class="menu-content wide">
        <p class="select-heading">CHOOSE YOUR FIGHTER <span>press 1–5</span></p>
        <p id="duel-select-note"></p>
        <div class="class-grid">${cols}</div>
      </div>
      <div id="duel-waiting">
        <div class="duel-waiting-box">
          <h2>LOCKED IN</h2>
          <p>waiting for your rival…</p>
        </div>
      </div>
    `;
    this.el.appendChild(s);
    s.querySelectorAll('.class-col').forEach((col) => {
      col.addEventListener('click', () => this._pickClass(col.dataset.class));
    });
  }

  _pickClass(id) {
    if (this.game.duel.phase === 'select') this.game.duel.pickClass(id);
    else this.game.startRun(id);
  }

  // ---------- duel screens ----------
  _buildMatch() {
    const s = document.createElement('div');
    s.id = 'menu-match';
    s.className = 'screen';
    s.innerHTML = `
      <div class="scrim"></div>
      <div class="menu-content">
        <h2 class="match-title">DUEL</h2>
        <div class="match-radar"><i></i><i></i><i></i></div>
        <p id="match-status">CONNECTING</p>
        <p class="match-hint">first to two rounds takes the match</p>
        <button class="btn" id="btn-match-cancel">CANCEL</button>
      </div>
    `;
    this.el.appendChild(s);
    s.querySelector('#btn-match-cancel').addEventListener('click', () => this.game.duel.cancelMatchmaking());
  }

  _buildDuelEnd() {
    const s = document.createElement('div');
    s.id = 'menu-duelend';
    s.className = 'screen';
    s.innerHTML = `
      <div class="scrim"></div>
      <div class="menu-content">
        <h2 id="duelend-title">VICTORY</h2>
        <p id="duelend-reason"></p>
        <div class="duelend-score">
          <div class="death-stat"><span id="duelend-me">0</span><label>YOU</label></div>
          <div class="duelend-vs">—</div>
          <div class="death-stat"><span id="duelend-opp">0</span><label>RIVAL</label></div>
        </div>
        <p id="duelend-note"></p>
        <button class="btn primary" id="btn-rematch">REMATCH</button>
        <button class="btn" id="btn-duel-menu">MAIN MENU</button>
      </div>
    `;
    this.el.appendChild(s);
    s.querySelector('#btn-rematch').addEventListener('click', () => this.game.duel.requestRematch());
    s.querySelector('#btn-duel-menu').addEventListener('click', () => this.game.duel.leave());
  }

  _buildDuelPause() {
    const s = document.createElement('div');
    s.id = 'menu-duelpause';
    s.className = 'screen';
    s.innerHTML = `
      <div class="scrim light"></div>
      <div class="menu-content">
        <h2 class="pause-title">STANDING DOWN</h2>
        <p class="duelpause-warn">the duel continues without you!</p>
        <button class="btn primary" id="btn-duel-resume">BACK TO THE FIGHT</button>
        <button class="btn" id="btn-duel-forfeit">FORFEIT MATCH</button>
      </div>
    `;
    this.el.appendChild(s);
    s.querySelector('#btn-duel-resume').addEventListener('click', () => {
      this.hideAll();
      this.game.input.requestLock();
    });
    s.querySelector('#btn-duel-forfeit').addEventListener('click', () => this.game.duel.leave());
  }

  setMatchStatus(text) {
    this.el.querySelector('#match-status').textContent = text;
  }

  showDuelSelect() {
    this.show('select');
    this.el.querySelector('#duel-select-note').textContent = 'DUEL — BEST OF THREE ROUNDS';
    this.el.querySelector('#duel-waiting').classList.remove('active');
  }

  markDuelPicked() {
    this.el.querySelector('#duel-waiting').classList.add('active');
  }

  setDuelOppStatus(text) {
    const note = this.el.querySelector('#duel-select-note');
    note.textContent = `DUEL — BEST OF THREE ROUNDS · ${text}`;
  }

  showDuelEnd(won, myScore, oppScore, reason, rematchAvailable) {
    const title = this.el.querySelector('#duelend-title');
    title.textContent = won ? 'VICTORY' : 'DEFEAT';
    title.className = won ? 'won' : 'lost';
    this.el.querySelector('#duelend-reason').textContent = reason;
    this.el.querySelector('#duelend-me').textContent = myScore;
    this.el.querySelector('#duelend-opp').textContent = oppScore;
    this.el.querySelector('#duelend-note').textContent = '';
    this.el.querySelector('#btn-rematch').style.display = rematchAvailable ? '' : 'none';
    this.show('duelend');
  }

  setDuelEndNote(text) {
    this.el.querySelector('#duelend-note').textContent = text;
  }

  _buildPause() {
    const s = document.createElement('div');
    s.id = 'menu-pause';
    s.className = 'screen';
    s.innerHTML = `
      <div class="scrim light"></div>
      <div class="menu-content">
        <h2 class="pause-title">PAUSED</h2>
        <button class="btn primary" id="btn-resume">RESUME</button>
        <button class="btn" id="btn-codex-pause">CODEX</button>
        <button class="btn" id="btn-abandon">ABANDON RUN</button>
      </div>
    `;
    this.el.appendChild(s);
    s.querySelector('#btn-resume').addEventListener('click', () => this.game.resume());
    s.querySelector('#btn-codex-pause').addEventListener('click', () => this.openCodex('pause'));
    s.querySelector('#btn-abandon').addEventListener('click', () => this.game.toMenu());
  }

  _buildDeath() {
    const s = document.createElement('div');
    s.id = 'menu-death';
    s.className = 'screen';
    s.innerHTML = `
      <div class="scrim red"></div>
      <div class="menu-content">
        <h2 class="death-title">THE SKY CLAIMS YOU</h2>
        <div class="death-stats">
          <div class="death-stat"><span id="death-wave">1</span><label>WAVE REACHED</label></div>
          <div class="death-stat"><span id="death-kills">0</span><label>KILLS</label></div>
          <div class="death-stat"><span id="death-best">0</span><label>CLASS BEST</label></div>
        </div>
        <div id="new-best" class="new-best">NEW BEST!</div>
        <button class="btn primary" id="btn-again">FIGHT AGAIN</button>
        <button class="btn" id="btn-change">CHANGE CLASS</button>
      </div>
    `;
    this.el.appendChild(s);
    s.querySelector('#btn-again').addEventListener('click', () => this.game.startRun(this.game.currentClassId));
    s.querySelector('#btn-change').addEventListener('click', () => this.game.showSelect());
  }

  // ---------- codex ----------
  _buildCodex() {
    const s = document.createElement('div');
    s.id = 'menu-codex';
    s.className = 'screen';

    // fighters: playstyle + every move (LMB + Q/E/R/F) with descriptions
    let fighters = '';
    for (const id of CLASS_LIST) {
      const c = CLASSES[id];
      const accent = '#' + c.color.toString(16).padStart(6, '0');
      const moves = [
        `<li><b>LMB</b><span><i>${c.basic.name}</i> — ${c.basic.desc || ''}</span></li>`,
        ...c.abilities.map((a) =>
          `<li><b>${a.slot}</b><span><i>${a.name}${a.chargeable ? ' ◈' : ''}</i> — ${a.desc}</span></li>`
        ),
      ].join('');
      fighters += `
        <div class="codex-class" style="--accent:${accent}">
          <h3>${c.name} <span class="codex-role">${c.role}</span></h3>
          <p class="codex-playstyle">${c.playstyle || c.tagline}</p>
          <ul class="codex-moves">${moves}</ul>
        </div>
      `;
    }

    // enemies: portrait + blurb + tip
    let enemies = '';
    for (const type of Object.keys(ENEMY_TYPES)) {
      const info = ENEMY_INFO[type];
      const def = ENEMY_TYPES[type];
      enemies += `
        <div class="codex-enemy${def.elite ? ' elite' : ''}">
          <img class="codex-photo" data-photo="${type}" alt="${info.name}">
          <div class="codex-enemy-text">
            <h3>${info.name} <span class="codex-threat">${info.threat}</span></h3>
            <p>${info.blurb}</p>
            <p class="codex-tip">◆ ${info.tip}</p>
          </div>
        </div>
      `;
    }

    s.innerHTML = `
      <div class="scrim"></div>
      <div class="menu-content wide codex-content">
        <div class="codex-head">
          <h2 class="codex-title">CODEX</h2>
          <button class="btn" id="btn-codex-back">BACK</button>
        </div>
        <div class="codex-scroll">
          <p class="codex-section">FIGHTERS</p>
          <div class="codex-classes">${fighters}</div>
          <p class="codex-section">ENEMIES</p>
          <div class="codex-enemies">${enemies}</div>
        </div>
      </div>
    `;
    this.el.appendChild(s);
    s.querySelector('#btn-codex-back').addEventListener('click', () => this.closeCodex());
  }

  openCodex(from) {
    this._codexFrom = from;
    this._renderEnemyPhotos();
    this.show('codex');
  }

  closeCodex() {
    this.show(this._codexFrom || 'main');
  }

  // render each enemy model once into a small offscreen canvas -> portrait img
  _renderEnemyPhotos() {
    if (this._photosDone) return;
    this._photosDone = true;
    const size = 220;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xbfd0ff, 1.2));
    const sun = new THREE.DirectionalLight(0xffe0b8, 2.4);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 60);
    for (const type of Object.keys(ENEMY_TYPES)) {
      const built = MODEL_BUILDERS[type]();
      // same self-illumination trick the game uses so they read on dark bg
      for (const m of built.materials) {
        if (m.emissive.getHex() === 0) m.emissive.copy(m.color).multiplyScalar(0.35);
      }
      scene.add(built.group);
      const box = new THREE.Box3().setFromObject(built.group);
      const center = box.getCenter(new THREE.Vector3());
      const sph = box.getBoundingSphere(new THREE.Sphere());
      const d = Math.max(sph.radius, 0.8) * 2.6;
      cam.position.set(center.x + d * 0.6, center.y + d * 0.32, center.z + d * 0.75);
      cam.lookAt(center);
      renderer.render(scene, cam);
      const url = renderer.domElement.toDataURL();
      const img = this.el.querySelector(`[data-photo="${type}"]`);
      if (img) img.src = url;
      scene.remove(built.group);
      built.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    renderer.dispose();
  }

  show(name) {
    for (const k in this.screens) this.screens[k].classList.toggle('active', k === name);
    this.el.classList.add('active');
    if (name === 'main') this._fillMainStats();
    if (name === 'select') {
      this._fillBests();
      // solo entry: clear any leftover duel dressing
      if (this.game.duel.phase !== 'select') {
        this.el.querySelector('#duel-select-note').textContent = '';
        this.el.querySelector('#duel-waiting').classList.remove('active');
      }
    }
  }

  hideAll() {
    for (const k in this.screens) this.screens[k].classList.remove('active');
    this.el.classList.remove('active');
  }

  _fillMainStats() {
    const st = this.game.stats;
    const best = st.bestOverall();
    const el = this.el.querySelector('#main-stats');
    el.innerHTML = best > 0
      ? `BEST WAVE <b>${best}</b> &nbsp;·&nbsp; TOTAL KILLS <b>${st.data.totalKills}</b>`
      : '';
  }

  _fillBests() {
    for (const id of CLASS_LIST) {
      const el = this.el.querySelector(`[data-best="${id}"]`);
      const best = this.game.stats.bestFor(id);
      el.textContent = best > 0 ? `BEST · WAVE ${best}` : '';
    }
  }

  showDeath(wave, kills, best, isNewBest) {
    this.el.querySelector('#death-wave').textContent = wave;
    this.el.querySelector('#death-kills').textContent = kills;
    this.el.querySelector('#death-best').textContent = best;
    this.el.querySelector('#new-best').classList.toggle('active', isNewBest);
    this.show('death');
  }

  _onKey(e) {
    const g = this.game;
    const active = (k) => this.screens[k].classList.contains('active');
    // codex overlays everything: Esc / Enter close it
    if (active('codex')) {
      if (e.code === 'Escape' || e.code === 'Enter') this.closeCodex();
      return;
    }
    if (active('main') && (e.code === 'Enter' || e.code === 'Space')) {
      g.showSelect();
    } else if (active('select')) {
      const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
      if (idx >= 0) this._pickClass(CLASS_LIST[idx]);
    } else if (active('death') && e.code === 'Enter') {
      g.startRun(g.currentClassId);
    } else if (active('pause') && e.code === 'Enter') {
      g.resume();
    } else if (active('duelpause') && e.code === 'Enter') {
      this.hideAll();
      g.input.requestLock();
    }
  }
}
