import { OT_AT } from './overtime.js';
import { MP_MAPS, MAP_DEFS } from './maps/index.js';

// ---------------------------------------------------------------------------
// DebugMenu: type "skybreakiscool" anywhere (menus or mid-fight) to toggle a
// tester panel — jump the overtime clock, heal, go invulnerable, force round
// results, quick-start bot duels, hop between maps. Type it again (or hit ✕)
// to close. Pure testing tool; nothing here is reachable without the code.
// ---------------------------------------------------------------------------

const CODE = 'skybreakiscool';

export class DebugMenu {
  constructor(game, root) {
    this.game = game;
    this._buf = '';
    this.el = document.createElement('div');
    this.el.id = 'debug-menu';
    this.el.innerHTML = `
      <div class="dbg-head"><b>DEBUG</b><button id="dbg-close">✕</button></div>
      <div class="dbg-section">OVERTIME CLOCK</div>
      <div class="dbg-row">
        <button id="dbg-ot10">OT IN 10s</button>
        <button id="dbg-otnow">OT NOW</button>
        <button id="dbg-plus30">+30s</button>
      </div>
      <div class="dbg-section">FIGHT</div>
      <div class="dbg-row">
        <button id="dbg-heal">HEAL</button>
        <button id="dbg-invuln">INVULN</button>
      </div>
      <div class="dbg-row">
        <button id="dbg-win">WIN ROUND</button>
        <button id="dbg-lose">LOSE ROUND</button>
      </div>
      <div class="dbg-section">QUICK BOT DUEL</div>
      <div class="dbg-row">
        <button data-dbgbot="rookie">ROOKIE</button>
        <button data-dbgbot="duelist">DUELIST</button>
        <button data-dbgbot="nightmare">NIGHTMARE</button>
      </div>
      <div class="dbg-section">JUMP TO MAP <span class="dbg-note">(restarts the arena)</span></div>
      <div class="dbg-maps">${MP_MAPS.map((id) =>
        `<button data-dbgmap="${id}">${MAP_DEFS[id].name}</button>`).join('')}
      </div>
      <div class="dbg-note" id="dbg-status"></div>
    `;
    root.appendChild(this.el);

    window.addEventListener('keydown', (e) => {
      if (e.key && e.key.length === 1 && /[a-z]/i.test(e.key)) {
        this._buf = (this._buf + e.key.toLowerCase()).slice(-CODE.length);
        if (this._buf === CODE) {
          this._buf = '';
          this.toggle();
        }
      }
    });

    const $ = (sel) => this.el.querySelector(sel);
    $('#dbg-close').addEventListener('click', () => this.toggle(false));
    $('#dbg-ot10').addEventListener('click', () => this._warpClock(OT_AT - 10));
    $('#dbg-otnow').addEventListener('click', () => this._warpClock(OT_AT));
    $('#dbg-plus30').addEventListener('click', () => {
      this.game.world.hazardClock += 30;
      this._status('+30s on the round clock');
    });
    $('#dbg-heal').addEventListener('click', () => {
      const p = this.game.player;
      p.health = p.maxHealth;
      this._status('healed to full');
    });
    $('#dbg-invuln').addEventListener('click', () => {
      const p = this.game.player;
      const on = (p.damageReduction || 0) < 1;
      p.damageReduction = on ? 1 : 0;
      $('#dbg-invuln').classList.toggle('on', on);
      this._status(on ? 'invulnerable (void still kills)' : 'mortal again');
    });
    $('#dbg-win').addEventListener('click', () => {
      const g = this.game;
      if (g.mode === 'botduel' && g.botDuel.phase === 'fighting') {
        g.botDuel.botHp = 0;
        g.botDuel._botDied();
        this._status('round won');
      } else this._status('only works mid bot-duel round');
    });
    $('#dbg-lose').addEventListener('click', () => {
      const g = this.game;
      if (g.state === 'playing' && g.player.alive) {
        g.player.health = 0;
        g.player.alive = false;
        g.player.onDeath?.();
        this._status('round lost');
      } else this._status('no live round');
    });
    this.el.querySelectorAll('[data-dbgbot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const g = this.game;
        if (g.mode === 'duel' || g.mode === 'ffa') { this._status('leave the online match first'); return; }
        if (g.mode === 'botduel') { g.botDuel._dispose(); g.botDuel.phase = 'idle'; }
        g.botDuel.start(g.currentClassId || 'mage', 'random', btn.dataset.dbgbot, 'random');
        this._status(`bot duel — ${btn.dataset.dbgbot}`);
      });
    });
    this.el.querySelectorAll('[data-dbgmap]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const g = this.game, map = btn.dataset.dbgmap;
        if (g.mode === 'duel' || g.mode === 'ffa') { this._status('leave the online match first'); return; }
        if (g.mode === 'botduel' && g.botDuel.active) {
          const bd = g.botDuel;
          const keep = { p: bd.playerClass, b: bd.botClass, d: bd.difficulty };
          bd._dispose(); bd.phase = 'idle';
          bd.start(keep.p, keep.b, keep.d, map);
        } else {
          g.startRun(g.currentClassId || 'mage', map);
        }
        this._status(`jumped to ${MAP_DEFS[map].name}`);
      });
    });
  }

  _warpClock(target) {
    const g = this.game;
    if (!g.world.overtime) { this._status('this map/mode has no overtime'); return; }
    if (!g.world.overtime.enabled) { this._status('overtime only runs in duels / ffa — start a bot duel'); return; }
    g.world.hazardClock = Math.max(g.world.hazardClock, target);
    this._status(target >= OT_AT ? 'OVERTIME!' : 'overtime in 10 seconds…');
  }

  _status(text) {
    this.el.querySelector('#dbg-status').textContent = text;
  }

  toggle(force) {
    const on = force !== undefined ? force : !this.el.classList.contains('active');
    this.el.classList.toggle('active', on);
  }
}
