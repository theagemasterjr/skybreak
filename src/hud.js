import * as THREE from 'three';
import { clamp } from './utils.js';
import { SLOT_ICONS } from './gambler.js';

const SLOT_GLYPHS = Object.keys(SLOT_ICONS);

// ---------------------------------------------------------------------------
// HUD: in-combat overlay. Health, dash pips, ability slots with cooldown
// sweeps, charge meter, wave banner, crosshair + hit marker, damage vignette,
// floating damage numbers, void-recovery warning.
// ---------------------------------------------------------------------------

const _v = new THREE.Vector3();

export class HUD {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.innerHTML = `
      <div id="vignette"></div>
      <div id="screen-flash"></div>
      <div id="void-warning">FALLING — DASH UP! <span class="key-hint">HOLD SPACE + SHIFT</span></div>
      <div id="crosshair">
        <span class="ch-dot"></span>
        <span class="ch-tick t"></span><span class="ch-tick b"></span>
        <span class="ch-tick l"></span><span class="ch-tick r"></span>
        <span class="ch-hit tl"></span><span class="ch-hit tr"></span>
        <span class="ch-hit bl"></span><span class="ch-hit br"></span>
      </div>
      <div id="wave-banner"><span id="wave-label">WAVE 1</span><span id="wave-remaining"></span></div>
      <div id="run-kills"></div>
      <div id="announce"></div>
      <div id="spectate-banner">
        <span id="spectate-line">SPECTATING <b id="spectate-name"></b></span>
        <span class="spectate-sub">when they fall, you follow their hunter</span>
      </div>
      <div id="bottom-left">
        <div id="hp-wrap">
          <div id="hp-bar"><div id="hp-fill"></div><div id="hp-ghost"></div><div id="hp-shield"></div></div>
          <div id="hp-num">100</div>
        </div>
        <div id="dash-pips"></div>
      </div>
      <div id="abilities"></div>
      <div id="charge-wrap"><div id="charge-fill"></div><span id="charge-label">CHARGING</span></div>
      <div id="slot-machine">
        <div class="sm-reels">
          <div class="sm-reel"><span></span></div>
          <div class="sm-reel"><span></span></div>
          <div class="sm-reel"><span></span></div>
        </div>
        <div id="sm-timer"><div id="sm-timer-fill"></div></div>
        <div id="sm-result"></div>
      </div>
      <div id="dmg-numbers"></div>
    `;
    root.appendChild(this.el);

    this.hpFill = this.el.querySelector('#hp-fill');
    this.hpGhost = this.el.querySelector('#hp-ghost');
    this.hpShield = this.el.querySelector('#hp-shield');
    this.hpNum = this.el.querySelector('#hp-num');
    this.dashPips = this.el.querySelector('#dash-pips');
    this.abilitiesEl = this.el.querySelector('#abilities');
    this.chargeWrap = this.el.querySelector('#charge-wrap');
    this.chargeFill = this.el.querySelector('#charge-fill');
    this.waveLabel = this.el.querySelector('#wave-label');
    this.waveRemaining = this.el.querySelector('#wave-remaining');
    this.runKillsEl = this.el.querySelector('#run-kills');
    this.announceEl = this.el.querySelector('#announce');
    this.vignette = this.el.querySelector('#vignette');
    this.screenFlash = this.el.querySelector('#screen-flash');
    this._flashT = 0;
    this._flashDur = 0.25;
    this.voidWarning = this.el.querySelector('#void-warning');
    this.crosshair = this.el.querySelector('#crosshair');
    this.dmgLayer = this.el.querySelector('#dmg-numbers');
    this.spectateBanner = this.el.querySelector('#spectate-banner');
    this.spectateName = this.el.querySelector('#spectate-name');

    this.slotMachineEl = this.el.querySelector('#slot-machine');
    this.smReels = [...this.el.querySelectorAll('.sm-reel span')];
    this.smResult = this.el.querySelector('#sm-result');
    this.smTimer = this.el.querySelector('#sm-timer');
    this.smTimerFill = this.el.querySelector('#sm-timer-fill');
    this._spin = null;        // live reel animation state

    this.slots = {};          // slot -> {el, cd, keyEl}
    this.pips = [];
    this.ghostHp = 1;
    this.hitTimer = 0;
    this.dmgFlashTimer = 0;
    this.announceTimer = 0;
    this.visible = false;
  }

  show() { this.el.classList.add('active'); this.visible = true; }
  hide() { this.el.classList.remove('active'); this.visible = false; }

  // build class-specific ability slots + dash pips
  bindClass(classDef, maxDashes) {
    this.abilitiesEl.innerHTML = '';
    this.slots = {};
    for (const a of classDef.abilities) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.innerHTML = `
        <div class="cd-sweep"></div>
        <span class="slot-key">${a.slot}</span>
        <span class="slot-name">${a.name}</span>
        ${a.chargeable ? '<span class="slot-charge">◈</span>' : ''}
      `;
      this.abilitiesEl.appendChild(slot);
      this.slots[a.slot] = { el: slot, sweep: slot.querySelector('.cd-sweep') };
    }
    this.dashPips.innerHTML = '';
    this.pips = [];
    for (let i = 0; i < maxDashes; i++) {
      const pip = document.createElement('span');
      pip.className = 'pip';
      this.dashPips.appendChild(pip);
      this.pips.push(pip);
    }
    const accent = '#' + classDef.color.toString(16).padStart(6, '0');
    this.el.style.setProperty('--class-accent', accent);

    // the Gambler's slot machine
    this.slotMachineEl.classList.toggle('active', !!classDef.slotMachine);
    this.slotMachineEl.classList.remove('jackpot', 'bad');
    this.smResult.textContent = '';
    this._spin = null;
    for (const r of this.smReels) { r.textContent = '❔'; r.style.removeProperty('color'); }
  }

  // Gambler: animate a spin. res = {reels: [iconId x3], kind, good, label}.
  // Reels cycle wildly, then lock left-to-right; the last lock (0.85s, matched
  // by the class's effect delay) reveals the result.
  spinSlots(res) {
    this._spin = { res, t: 0, cycle: 0, locked: [false, false, false], resultShown: false, doneT: 0 };
    this.slotMachineEl.classList.remove('jackpot', 'bad', 'land');
    this.smResult.textContent = '';
    this.smResult.className = '';
  }

  _updateSlotMachine(dt) {
    // duration bar: how long the landed roll's effect keeps running
    const st = this.game.combat?.state;
    if (st && this.slotMachineEl.classList.contains('active')) {
      const frac = st.rollTotal > 0 ? Math.max(0, st.rollT || 0) / st.rollTotal : 0;
      this.smTimerFill.style.width = (frac * 100) + '%';
      this.smTimer.classList.toggle('on', frac > 0);
    }
    const S = this._spin;
    if (!S) return;
    S.t += dt;
    const LOCK_AT = [0.35, 0.58, 0.85];
    // unlocked reels flicker through random faces
    S.cycle -= dt;
    if (S.cycle <= 0) {
      S.cycle = 0.055;
      for (let i = 0; i < 3; i++) {
        if (S.locked[i]) continue;
        const id = SLOT_GLYPHS[(Math.random() * SLOT_GLYPHS.length) | 0];
        this.smReels[i].textContent = SLOT_ICONS[id].glyph;
        this.smReels[i].style.color = SLOT_ICONS[id].color;
      }
    }
    for (let i = 0; i < 3; i++) {
      if (!S.locked[i] && S.t >= LOCK_AT[i]) {
        S.locked[i] = true;
        const id = S.res.reels[i];
        this.smReels[i].textContent = SLOT_ICONS[id].glyph;
        this.smReels[i].style.color = SLOT_ICONS[id].color;
        this.smReels[i].parentElement.classList.remove('lock');
        void this.smReels[i].parentElement.offsetWidth;
        this.smReels[i].parentElement.classList.add('lock');
      }
    }
    if (!S.resultShown && S.t >= LOCK_AT[2]) {
      S.resultShown = true;
      this.smResult.textContent = S.res.label;
      this.smResult.className = S.res.kind === 'jackpot' ? 'jackpot' : S.res.good ? 'good' : 'bad';
      this.slotMachineEl.classList.add(S.res.kind === 'jackpot' ? 'jackpot' : S.res.good ? 'land' : 'bad');
    }
    if (S.resultShown) {
      S.doneT += dt;
      if (S.doneT > 2.4) {
        this.slotMachineEl.classList.remove('jackpot', 'bad', 'land');
        this.smResult.textContent = '';
        this._spin = null;
      }
    }
  }

  flashAbility(slot) {
    const s = this.slots[slot];
    if (!s) return;
    s.el.classList.remove('cast');
    void s.el.offsetWidth; // restart animation
    s.el.classList.add('cast');
  }

  denyAbility(slot) {
    const s = this.slots[slot];
    if (!s) return;
    s.el.classList.remove('deny');
    void s.el.offsetWidth;
    s.el.classList.add('deny');
  }

  announceWave(n) {
    this.waveLabel.textContent = `WAVE ${n}`;
    this._announce(`WAVE ${n}`, '');
  }

  announceCleared(n) {
    this._announce('WAVE CLEARED', 'sub');
  }

  // duel mode: round countdowns, results, taunts
  announce(text, cls = '') {
    this._announce(text, cls);
  }

  // duel mode: the wave banner becomes the round + score readout
  setDuelInfo(round, myScore, oppScore) {
    this.waveLabel.textContent = `ROUND ${round}`;
    this.waveRemaining.textContent = `YOU ${myScore} · ${oppScore} RIVAL`;
  }

  // FFA: top-center "SPECTATING <NAME>" banner, or hide it when null. Safe to call repeatedly.
  setSpectating(nameOrNull) {
    if (nameOrNull) {
      this.spectateName.textContent = nameOrNull;
      this.spectateBanner.classList.add('active');
    } else {
      this.spectateBanner.classList.remove('active');
    }
  }

  _announce(text, cls) {
    this.announceEl.textContent = text;
    this.announceEl.className = cls;
    this.announceEl.classList.remove('pop');
    void this.announceEl.offsetWidth;
    this.announceEl.classList.add('pop');
  }

  hitMarker(killed = false) {
    this.crosshair.classList.remove('hit', 'kill');
    void this.crosshair.offsetWidth;
    this.crosshair.classList.add(killed ? 'kill' : 'hit');
  }

  damageFlash() {
    this.dmgFlashTimer = 0.4;
  }

  // full-screen color pop (elite kills, detonations)
  flash(color, dur = 0.25) {
    this.screenFlash.style.background = color;
    this._flashT = dur;
    this._flashDur = dur;
  }

  // floating damage number at a world position
  spawnDamageNumber(worldPos, amount, opts = {}) {
    if (this.dmgLayer.childElementCount > 24) return;
    _v.copy(worldPos).project(this.game.camera);
    if (_v.z > 1) return;
    const x = (_v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
    const d = document.createElement('span');
    d.className = 'dmg-num' + (opts.big ? ' big' : '');
    d.textContent = Math.round(amount);
    d.style.left = (x + (Math.random() - 0.5) * 30) + 'px';
    d.style.top = (y + (Math.random() - 0.5) * 14) + 'px';
    this.dmgLayer.appendChild(d);
    setTimeout(() => d.remove(), 750);
  }

  update(dt) {
    if (!this.visible) return;
    const g = this.game;
    const p = g.player;

    this._updateSlotMachine(dt);

    // health
    const frac = clamp(p.health / p.maxHealth, 0, 1);
    this.hpFill.style.width = (frac * 100) + '%';
    // ghost bar lags behind for readable damage chunks
    this.ghostHp += (frac - this.ghostHp) * Math.min(1, dt * 3);
    if (this.ghostHp < frac) this.ghostHp = frac;
    this.hpGhost.style.width = (this.ghostHp * 100) + '%';
    this.hpNum.textContent = Math.ceil(p.health + p.shield);
    this.hpShield.style.width = (clamp(p.shield / p.maxHealth, 0, 1) * 100) + '%';
    this.el.classList.toggle('low-hp', frac < 0.3 && p.alive);

    // dash pips
    for (let i = 0; i < this.pips.length; i++) {
      const pip = this.pips[i];
      if (i < p.dashCharges) {
        pip.className = 'pip full';
        pip.style.removeProperty('--fill');
      } else if (i === p.dashCharges) {
        pip.className = 'pip charging';
        pip.style.setProperty('--fill', (p.dashRecharge * 100) + '%');
      } else {
        pip.className = 'pip';
        pip.style.removeProperty('--fill');
      }
    }

    // ability cooldowns
    if (g.combat) {
      for (const a of g.combat.classDef.abilities) {
        const s = this.slots[a.slot];
        if (!s) continue;
        const cd = g.combat.cooldowns[a.slot];
        const fracCd = cd > 0 ? cd / a.cooldown : 0;
        s.el.classList.toggle('on-cd', cd > 0);
        s.sweep.style.background = cd > 0
          ? `conic-gradient(rgba(10,12,24,0.78) ${fracCd * 360}deg, transparent 0deg)`
          : 'none';
      }
      // charge meter
      const ch = g.combat.charging;
      this.chargeWrap.classList.toggle('active', !!ch);
      if (ch) {
        const k = ch.t / g.combat.CHARGE_TIME;
        this.chargeFill.style.width = (k * 100) + '%';
        this.chargeWrap.classList.toggle('full', k >= 1);
      }
    }

    // wave info (duel mode owns the banner via setDuelInfo instead)
    if (g.waves && g.mode !== 'duel') {
      const rem = g.waves.remaining();
      this.waveRemaining.textContent = g.waves.state === 'between' ? 'CLEARED' : `${rem} LEFT`;
    }
    this.runKillsEl.textContent = g.mode !== 'duel' && g.runKills > 0 ? `${g.runKills} KILLS` : '';

    // damage vignette
    if (this.dmgFlashTimer > 0) this.dmgFlashTimer -= dt;
    const lowHp = frac < 0.3 && p.alive;
    const flash = Math.max(0, this.dmgFlashTimer / 0.4);
    this.vignette.style.opacity = Math.min(1, flash * 0.85 + (lowHp ? 0.35 : 0));

    // screen flash decay
    if (this._flashT > 0) {
      this._flashT -= dt;
      this.screenFlash.style.opacity = Math.max(0, this._flashT / this._flashDur);
    } else {
      this.screenFlash.style.opacity = 0;
    }

    // void warning
    this.voidWarning.classList.toggle('active', p.inRecoverZone && p.alive);
  }
}
