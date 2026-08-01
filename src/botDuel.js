import * as THREE from 'three';
import { DuelOpponent } from './duelOpponent.js';
import { CLASSES, CLASS_LIST } from './classes.js';
import { randomMapId } from './maps/index.js';
import { BotBrain } from './botBrain.js';

// ---------------------------------------------------------------------------
// BotDuel: singleplayer 1v1 against an AI duelist. Mirrors Duel's round
// machine (best of three, countdown, spawn table, score) with zero
// networking: the rival body is a DuelOpponent driven by a local BotBrain,
// and this controller is the "owner" that DuelOpponent's damage path needs
// (canDealDamage + sendHitFor). BotDuel owns the bot's authoritative vitals.
// ---------------------------------------------------------------------------

export const BOT_NAMES = ['VEX-2', 'NULLBLADE', 'KIRA-9', 'SABLE', 'ORIN-7', 'HALCYON', 'DUSKWING', 'MARROW'];
const ROUNDS_TO_WIN = 2;
const _v1 = new THREE.Vector3();

export class BotDuel {
  constructor(game) {
    this.game = game;
    this.phase = 'idle';   // idle | countdown | fighting | roundover | matchover
    this.avatar = null;
    this.brain = null;
    this.round = 0;
    this.score = { me: 0, opp: 0 };
    this.botName = '';
  }

  get active() { return this.phase !== 'idle'; }
  canDealDamage() { return this.phase === 'fighting'; }

  start(playerClass, botClass, difficulty, mapId) {
    const g = this.game;
    this.playerClass = playerClass;
    this.botClass = botClass === 'random'
      ? CLASS_LIST[(Math.random() * CLASS_LIST.length) | 0]
      : botClass;
    this.difficulty = difficulty;
    this.botName = BOT_NAMES[(Math.random() * BOT_NAMES.length) | 0];
    this.mapId = (!mapId || mapId === 'random') ? randomMapId() : mapId;
    this.seed = (Math.random() * 1e9) | 0;
    this.score = { me: 0, opp: 0 };
    g.startDuel(playerClass, this.mapId, this.seed);   // map/class/hud setup
    g.mode = 'botduel';                                // then claim the mode
    this.avatar = new DuelOpponent(g, this, this.botClass, { name: this.botName });
    g.enemies.push(this.avatar);
    this.botMaxHp = CLASSES[this.botClass].stats.maxHealth;
    this.brain = new BotBrain(g, this, this.avatar, difficulty);
    this._startRound(1);
    g.hud.announce(`VS ${this.botName} ✦`, 'sub');
  }

  _startRound(n) {
    const g = this.game;
    this.round = n;
    this.phase = 'countdown';
    this._cdT = 3.6;
    this._cdLast = 99;
    this.botHp = this.botMaxHp;
    this._botPoison = null;
    this._botSlowT = 0;
    this._botFrozenT = 0;
    this._botLastHit = -999;
    g.projectiles.clear();
    g.resetCombatState();
    // through loadMap so an overtime-wrecked arena rebuilds clean
    g.loadMap(this.mapId, (this.seed || 1) + n);
    const table = g.world.mapDef.spawns.duel;
    g.player.respawn();
    g.player.position.set(table[0][0], table[0][1], table[0][2]);
    g.player.yaw = table[0][3];
    g.player.pitch = 0;
    g.player.freeze = true;
    this.avatar.respawn(_v1.set(table[1][0], table[1][1], table[1][2]), table[1][3]);
    this.avatar.maxHp = this.botMaxHp;
    this.avatar.hp = this.botHp;
    this.brain?.reset();
    g.hud.setDuelInfo(this.round, this.score.me, this.score.opp, this.botName);
    g.hud.announce(n === 1 ? g.world.mapDef.name : `ROUND ${n}`, '');
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game;

    if (this.phase === 'countdown') {
      this._cdT -= dt;
      const sec = Math.ceil(this._cdT);
      if (sec !== this._cdLast && sec >= 1 && sec <= 3) {
        this._cdLast = sec;
        g.hud.announce(String(sec), 'sub');
        g.audio?.play('chargeStart');
      }
      this.brain?.updateIdle(dt);
      if (this._cdT <= 0) {
        this.phase = 'fighting';
        g.player.freeze = false;
        g.hud.announce('FIGHT!', '');
        g.audio?.play('runStart');
      }
      return;
    }

    if (this.phase === 'fighting') {
      // bot status effects (what a remote client would apply to itself)
      if (this._botFrozenT > 0) this._botFrozenT -= dt;
      if (this._botSlowT > 0) this._botSlowT -= dt;
      if (this._botPoison && this.avatar.alive) {
        this._botPoison.t -= dt;
        this._applyBotDamage(this._botPoison.dps * dt, null);
        if (this._botPoison && this._botPoison.t <= 0) this._botPoison = null;
      }
      // out-of-combat trickle, both sides
      if (g.player.alive && g.simTime - (g.player.lastDamagedAt ?? -999) >= 10) {
        g.player.heal(1 * dt);
      }
      if (this.avatar.alive && g.simTime - this._botLastHit >= 10) {
        this.botHp = Math.min(this.botMaxHp, this.botHp + 1 * dt);
      }
      this.brain?.update(dt);
      this.avatar.hp = this.botHp;
      this.avatar.maxHp = this.botMaxHp;
      // void deaths (both directions once gravity has flipped)
      const sky = g.world.skyKillY;
      if (g.player.alive && (g.player.position.y < -95 || (sky !== null && g.player.position.y > sky))) {
        g.player.alive = false;
        this.localDied();
      }
      if (this.avatar.alive && (this.avatar.position.y < -95 || (sky !== null && this.avatar.position.y > sky))) {
        this._botDied();
      }
      return;
    }

    if (this.phase === 'roundover') {
      this.brain?.updateIdle(dt);
      this._overT -= dt;
      if (this._overT <= 0) {
        if (this.score.me >= ROUNDS_TO_WIN || this.score.opp >= ROUNDS_TO_WIN) {
          this._matchOver(this.score.me > this.score.opp);
        } else {
          this._startRound(this.round + 1);
        }
      }
    }
  }

  // my attack landed on the bot's body (DuelOpponent.takeDamage forwards here)
  sendHitFor(avatar, dmg, knockback, freeze, poison, slow) {
    this._applyBotDamage(dmg, knockback);
    if (freeze > 0) this._botFrozenT = Math.max(this._botFrozenT, freeze);
    if (slow > 0) this._botSlowT = Math.max(this._botSlowT, slow);
    if (poison) {
      this._botPoison = {
        t: Math.max(this._botPoison?.t || 0, poison.t),
        dps: Math.max(this._botPoison?.dps || 0, poison.dps),
      };
    }
  }

  _applyBotDamage(dmg, knockback) {
    if (this.phase !== 'fighting' || !this.avatar?.alive) return;
    this.botHp -= dmg;
    this._botLastHit = this.game.simTime;
    if (knockback && this.brain) {
      this.brain.vel.add(knockback);
      this.brain.grounded = false;
    }
    if (this.botHp <= 0) {
      this.botHp = 0;
      this._botDied();
    }
  }

  localDied() {
    if (this.phase !== 'fighting') return;
    this.phase = 'roundover';
    this._overT = 2.6;
    this.score.opp++;
    this.game.hud.announce('ROUND LOST', 'sub');
    // (death audio comes from Game._onPlayerDeath; playing it here too doubled it)
    this.game.hud.setDuelInfo(this.round, this.score.me, this.score.opp, this.botName);
    this.brain?.onRoundWon();
  }

  _botDied() {
    if (this.phase !== 'fighting') return;
    this.avatar.die();
    this.phase = 'roundover';
    this._overT = 2.6;
    this.score.me++;
    this.game.hud.announce('ROUND WON', '');
    this.game.hud.flash('rgba(120, 220, 140, 0.14)', 0.4);
    this.game.audio?.play('waveClear');
    this.game.hud.setDuelInfo(this.round, this.score.me, this.score.opp, this.botName);
  }

  _matchOver(won) {
    const g = this.game;
    this.phase = 'matchover';
    g.player.freeze = true;
    document.exitPointerLock?.();
    g.state = 'select';
    g.hud.hide();
    g.menus.showDuelEnd(
      won, this.score.me, this.score.opp,
      won ? `${this.botName} POWERS DOWN` : `${this.botName} TAKES THE SKY`,
      true
    );
    g.audio?.play(won ? 'waveClear' : 'playerDeath');
  }

  requestRematch() {
    if (this.phase !== 'matchover') return;
    const keep = { p: this.playerClass, b: this.botClass, d: this.difficulty };
    this._dispose();
    this.phase = 'idle';
    this.start(keep.p, keep.b, keep.d, 'random');
  }

  leave() {
    this._dispose();
    this.phase = 'idle';
    this.game.mode = 'solo';
    this.game.toMenu();
  }

  _dispose() {
    if (!this.avatar) return;
    const idx = this.game.enemies.indexOf(this.avatar);
    if (idx >= 0) this.game.enemies.splice(idx, 1);
    this.avatar.dispose();
    this.avatar = null;
    this.brain = null;
  }
}
