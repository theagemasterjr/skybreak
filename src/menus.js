import * as THREE from 'three';
import { CLASSES, CLASS_LIST } from './classes.js';
import { ENEMY_TYPES, ENEMY_INFO } from './enemies.js';
import { MODEL_BUILDERS } from './enemyModels.js';
import { getSensMult, setSensMult, getAimSensMult, setAimSensMult } from './settings.js';
import { MAP_DEFS, MP_MAPS, randomMapId } from './maps/index.js';
import { TUTORIAL_SCRIPTS } from './tutorials.js';

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
    this.soloMap = 'classic';   // solo map choice (persists across runs)
    this._buildMain();
    this._buildSelect();
    this._buildTutorialPick();
    this._buildPause();
    this._buildDeath();
    this._buildCodex();
    this._buildMatch();
    this._buildDuelEnd();
    this._buildDuelPause();
    this._buildMp();
    this._buildLobby();
    this._buildMpPause();
    this.screens = {
      main: this.el.querySelector('#menu-main'),
      select: this.el.querySelector('#menu-select'),
      pause: this.el.querySelector('#menu-pause'),
      death: this.el.querySelector('#menu-death'),
      tut: this.el.querySelector('#menu-tut'),
      codex: this.el.querySelector('#menu-codex'),
      match: this.el.querySelector('#menu-match'),
      duelend: this.el.querySelector('#menu-duelend'),
      duelpause: this.el.querySelector('#menu-duelpause'),
      mp: this.el.querySelector('#menu-mp'),
      lobby: this.el.querySelector('#menu-lobby'),
      mppause: this.el.querySelector('#menu-mppause'),
    };
    this._codexFrom = 'main';   // screen to return to when the codex closes

    // mouse sensitivity sliders on the main menu and every pause screen
    this._sensControls = [];
    this._aimControls = [];
    for (const name of ['main', 'pause', 'duelpause', 'mppause']) {
      this._addSensControl(this.screens[name]);
    }

    window.addEventListener('keydown', (e) => this._onKey(e));
  }

  _addSensControl(screen) {
    const content = screen.querySelector('.menu-content');
    this._addSliderRow(content, this._sensControls, 'MOUSE SENSITIVITY', 10, 300,
      Math.round(getSensMult() * 100), (v) => {
        setSensMult(v / 100);
        this.game.player?.applySensitivity();
      });
    this._addSliderRow(content, this._aimControls, 'AIM SENSITIVITY · HOLD RMB', 10, 100,
      Math.round(getAimSensMult() * 100), (v) => setAimSensMult(v / 100));
  }

  _addSliderRow(content, list, labelText, min, max, pct, apply) {
    const row = document.createElement('div');
    row.className = 'sens-row';
    row.innerHTML = `
      <label>${labelText} <b>${pct}%</b></label>
      <input type="range" min="${min}" max="${max}" step="5" value="${pct}" aria-label="${labelText}">
    `;
    const slider = row.querySelector('input');
    const label = row.querySelector('b');
    slider.addEventListener('keydown', (e) => e.stopPropagation());
    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      apply(v);
      for (const c of list) {
        c.slider.value = v;
        c.label.textContent = v + '%';
      }
    });
    content.appendChild(row);
    list.push({ slider, label });
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
        <button class="btn duel" id="btn-multiplayer">MULTIPLAYER <span class="btn-tag">ONLINE</span></button>
        <button class="btn" id="btn-tutorial">TUTORIAL</button>
        <button class="btn" id="btn-codex-main">CODEX</button>
        <div class="menu-stats" id="main-stats"></div>
        <div class="controls-hint">
          <span><b>WASD</b> move</span><span><b>SPACE</b> double&nbsp;jump</span>
          <span><b>SHIFT</b> air&nbsp;dash</span><span><b>MOUSE</b> attack</span>
          <span><b>RMB</b> steady&nbsp;aim</span>
          <span><b>Q&nbsp;E&nbsp;R&nbsp;F</b> abilities&nbsp;·&nbsp;hold&nbsp;to&nbsp;charge&nbsp;◈</span>
        </div>
      </div>
    `;
    this.el.appendChild(s);
    s.querySelector('#btn-play').addEventListener('click', () => this.game.showSelect());
    s.querySelector('#btn-multiplayer').addEventListener('click', () => {
      this.show('mp');
      this.game.ffa.refreshRooms();
    });
    s.querySelector('#btn-tutorial').addEventListener('click', () => this.show('tut'));
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
    // solo battleground picker: the 5 arenas + random + training grounds
    const mapChips = [...MP_MAPS.map((id) => [id, MAP_DEFS[id].name]),
      ['random', 'RANDOM'], ['training', 'TRAINING']]
      .map(([id, name]) => `<button class="map-chip${id === 'classic' ? ' on' : ''}" data-map="${id}">${name}</button>`)
      .join('');
    s.innerHTML = `
      <div class="scrim"></div>
      <div class="menu-content wide">
        <p class="select-heading">CHOOSE YOUR FIGHTER <span>press 1–6</span></p>
        <p id="duel-select-note"></p>
        <div id="map-row"><span class="map-row-label">BATTLEGROUND</span>${mapChips}</div>
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
    s.querySelectorAll('.map-chip').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        this.soloMap = chip.dataset.map;
        s.querySelectorAll('.map-chip').forEach((c) => c.classList.toggle('on', c === chip));
      });
    });
  }

  _pickClass(id) {
    if (this.game.ffa.active && this.game.ffa.phase === 'lobby') { this.game.ffa.pickClass(id); return; }
    if (this.game.duel.phase === 'select') { this.game.duel.pickClass(id); return; }
    if (this.soloMap === 'training') { this.game.startTutorial(id, 'free', 'training'); return; }
    this.game.startRun(id, this.soloMap === 'random' ? randomMapId() : this.soloMap);
  }

  // ---------- tutorial picker ----------
  _buildTutorialPick() {
    const s = document.createElement('div');
    s.id = 'menu-tut';
    s.className = 'screen';
    const cards = Object.entries(TUTORIAL_SCRIPTS).map(([id, t]) => {
      const cls = id === 'basics' ? null : CLASSES[t.classId];
      const accent = cls ? '#' + cls.color.toString(16).padStart(6, '0') : 'var(--gold, #ffd76a)';
      const sub = id === 'basics' ? 'movement · attacks · charging' : `master the ${cls.name.toLowerCase()}`;
      return `
        <button class="tut-card${id === 'basics' ? ' basics' : ''}" data-tut="${id}" style="--accent:${accent}">
          <b>${t.title}</b><span>${sub}</span>
        </button>
      `;
    }).join('');
    s.innerHTML = `
      <div class="scrim"></div>
      <div class="menu-content">
        <h2 class="tut-title">TUTORIALS</h2>
        <p class="tut-sub">guided objectives on the training grounds — finish them or just mess around</p>
        <div class="tut-grid">${cards}</div>
        <button class="btn" id="btn-tut-back">BACK</button>
      </div>
    `;
    this.el.appendChild(s);
    s.querySelectorAll('.tut-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.tut;
        const t = TUTORIAL_SCRIPTS[id];
        this.game.startTutorial(t.classId, id, 'training');
      });
    });
    s.querySelector('#btn-tut-back').addEventListener('click', () => this.show('main'));
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

  // ---------- multiplayer (FFA) screens ----------
  _buildMp() {
    const s = document.createElement('div');
    s.id = 'menu-mp';
    s.className = 'screen';
    s.innerHTML = `
      <div class="scrim"></div>
      <div class="menu-content wide">
        <h2 class="mp-title">MULTIPLAYER</h2>
        <button class="btn duel" id="btn-mp-duel">DUEL — QUICK MATCH <span class="btn-tag">1v1 · BEST OF 3</span></button>
        <div class="mp-ffa">
          <p class="mp-section-label">FREE FOR ALL <span>2-4 players · last one flying wins</span></p>
          <div id="mp-rooms"></div>
          <p id="mp-status"></p>
          <div class="mp-create-row">
            <input type="text" id="mp-room-name" maxlength="20" placeholder="NAME YOUR ARENA">
            <button class="btn" id="btn-mp-create">CREATE</button>
          </div>
          <div class="mp-actions">
            <button class="btn" id="btn-mp-refresh">REFRESH</button>
            <button class="btn" id="btn-mp-back">BACK</button>
          </div>
        </div>
      </div>
    `;
    this.el.appendChild(s);
    s.querySelector('#btn-mp-duel').addEventListener('click', () => this.game.duel.startMatchmaking());
    s.querySelector('#btn-mp-refresh').addEventListener('click', () => this.game.ffa.refreshRooms());
    s.querySelector('#btn-mp-back').addEventListener('click', () => {
      this.game.ffa.stopBrowsing();
      this.show('main');
    });
    const input = s.querySelector('#mp-room-name');
    const doCreate = () => this.game.ffa.createRoom(input.value.trim() || 'SKY ARENA');
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') doCreate();
    });
    s.querySelector('#btn-mp-create').addEventListener('click', doCreate);
  }

  setRoomList(rooms) {
    const el = this.el.querySelector('#mp-rooms');
    if (rooms === null) {
      el.innerHTML = '<p class="mp-rooms-msg">SCANNING THE SKIES…</p>';
      return;
    }
    if (rooms.length === 0) {
      el.innerHTML = '<p class="mp-rooms-msg">NO OPEN ARENAS — FORGE ONE</p>';
      return;
    }
    el.innerHTML = rooms.map((r) => {
      const full = r.count >= r.max;
      return `
        <div class="mp-room-row">
          <span class="mp-room-name">${r.name}</span>
          <span class="mp-room-count">${r.count}/${r.max} FIGHTERS</span>
          ${r.inRound ? '<span class="mp-room-tag">IN ROUND</span>' : ''}
          <button class="btn mp-room-join" data-slot="${r.slot}"${full ? ' disabled' : ''}>JOIN</button>
        </div>
      `;
    }).join('');
    el.querySelectorAll('.mp-room-join').forEach((btn) => {
      btn.addEventListener('click', () => this.game.ffa.joinRoom(Number(btn.dataset.slot)));
    });
  }

  setMpStatus(text) {
    this.el.querySelector('#mp-status').textContent = text || '';
  }

  refreshMpScreen() {
    this.game.ffa.refreshRooms();
  }

  _buildLobby() {
    const s = document.createElement('div');
    s.id = 'menu-lobby';
    s.className = 'screen';
    s.innerHTML = `
      <div class="scrim"></div>
      <div class="menu-content">
        <h2 id="lobby-title" class="lobby-title">ARENA</h2>
        <p class="lobby-sub">FREE FOR ALL — first to fall spectates</p>
        <div id="lobby-players" class="lobby-players"></div>
        <p id="lobby-note" class="lobby-note"></p>
        <button class="btn" id="btn-lobby-class">CHOOSE CLASS</button>
        <button class="btn primary" id="btn-lobby-start">START ROUND</button>
        <button class="btn" id="btn-lobby-leave">LEAVE ROOM</button>
      </div>
    `;
    this.el.appendChild(s);
    s.querySelector('#btn-lobby-class').addEventListener('click', () => {
      this.show('select');
      this.el.querySelector('#duel-select-note').textContent = 'FREE FOR ALL — PICK YOUR FIGHTER';
    });
    s.querySelector('#btn-lobby-start').addEventListener('click', () => this.game.ffa.startRound());
    s.querySelector('#btn-lobby-leave').addEventListener('click', () => this.game.ffa.leaveRoom());
  }

  showLobby() {
    this.show('lobby');
  }

  renderLobby(state) {
    if (!state) return;
    this.el.querySelector('#lobby-title').textContent = state.roomName;
    const list = this.el.querySelector('#lobby-players');
    list.innerHTML = state.players.map((p) => {
      const clsName = p.cls ? (CLASSES[p.cls]?.name || p.cls) : 'PICKING…';
      const tags = (p.isHost ? '<span class="lobby-tag host">HOST</span>' : '')
        + (p.me ? '<span class="lobby-tag you">YOU</span>' : '');
      return `
        <div class="lobby-row${p.me ? ' me' : ''}">
          <span class="lobby-name">${p.name}</span>
          <span class="lobby-class">${clsName}</span>
          <span class="lobby-wins">★ ${p.wins}</span>
          ${tags}
        </div>
      `;
    }).join('');

    const note = this.el.querySelector('#lobby-note');
    if (state.phase !== 'lobby') {
      note.textContent = "ROUND IN PROGRESS — YOU'LL FLY NEXT ROUND";
    } else if (state.players.length < state.minPlayers) {
      note.textContent = 'WAITING FOR FIGHTERS (2+ TO START)';
    } else {
      note.textContent = '';
    }

    const startBtn = this.el.querySelector('#btn-lobby-start');
    startBtn.style.display = state.isHost ? '' : 'none';
    startBtn.disabled = state.players.length < state.minPlayers;
  }

  _buildMpPause() {
    const s = document.createElement('div');
    s.id = 'menu-mppause';
    s.className = 'screen';
    s.innerHTML = `
      <div class="scrim light"></div>
      <div class="menu-content">
        <h2 class="pause-title">STANDING DOWN</h2>
        <p class="duelpause-warn">the round continues without you!</p>
        <button class="btn primary" id="btn-mp-resume">BACK TO THE FIGHT</button>
        <button class="btn" id="btn-mp-leave">LEAVE ROOM</button>
      </div>
    `;
    this.el.appendChild(s);
    s.querySelector('#btn-mp-resume').addEventListener('click', () => {
      this.hideAll();
      this.game.input.requestLock();
    });
    s.querySelector('#btn-mp-leave').addEventListener('click', () => this.game.ffa.leaveRoom());
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
      // the battleground row is a solo thing — multiplayer rolls its own map
      const mpPick = this.game.duel.phase === 'select'
        || (this.game.ffa.active && this.game.ffa.phase === 'lobby');
      this.el.querySelector('#map-row').style.display = mpPick ? 'none' : '';
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
    if (active('tut') && e.code === 'Escape') {
      this.show('main');
    } else if (active('main') && (e.code === 'Enter' || e.code === 'Space')) {
      g.showSelect();
    } else if (active('select')) {
      const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(e.code);
      if (idx >= 0) this._pickClass(CLASS_LIST[idx]);
    } else if (active('death') && e.code === 'Enter') {
      g.startRun(g.currentClassId);
    } else if (active('pause') && e.code === 'Enter') {
      g.resume();
    } else if (active('duelpause') && e.code === 'Enter') {
      this.hideAll();
      g.input.requestLock();
    } else if (active('mppause') && e.code === 'Enter') {
      this.hideAll();
      g.input.requestLock();
    }
  }
}
