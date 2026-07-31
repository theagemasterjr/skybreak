import * as THREE from 'three';
import { DuelNet } from './net.js';
import { DuelOpponent } from './duelOpponent.js';
import { recordingEffects, applyFx, killFxProps } from './fxNet.js';
import { randomMapId } from './maps/index.js';

// ---------------------------------------------------------------------------
// Duel: 1v1 online mode. Owns matchmaking, the message protocol, the round
// state machine (best of three — first to TWO round wins takes the match),
// and the opponent avatar.
//
// Netcode model (built for a handful of casual players, not esports):
//  - each client simulates ONLY its own player; 20Hz snapshots drive the
//    other side's avatar
//  - damage is shooter-authoritative: when MY attacks hit YOUR avatar in MY
//    world, I send a hit event and you apply it to yourself
//  - your own projectiles are replicated to the peer as cosmetic copies
//  - each client reports its own death; both then resolve the round
// ---------------------------------------------------------------------------

const SEND_INTERVAL = 0.05;      // 20Hz snapshots
const ROUNDS_TO_WIN = 2;         // best of three
// spawn points come from the rolled map's def: spawns.duel = [host, guest],
// each entry [x, y, z, yaw]

const _v1 = new THREE.Vector3();

export class Duel {
  constructor(game) {
    this.game = game;
    this.net = null;
    this.avatar = null;
    this.phase = 'idle';   // idle | searching | select | countdown | fighting | roundover | matchover
    this.role = null;
    this.myClass = null;
    this.oppClass = null;
    this.mapId = 'classic';   // rolled by the host per match
    this.seed = 1;
    this.round = 0;
    this.score = { me: 0, opp: 0 };
    this._sendT = 0;
    this._recvAge = 0;
    this._cdT = 0; this._cdLast = -1;
    this._overT = 0; this._commitT = 0; this._committed = false;
    this._roundResult = null;
    this._poison = null;   // {t, dps} incoming DoT
    this._slowT = 0;
    this._baseWalkSpeed = 0;
    this._rematchMe = false;
    this._rematchThem = false;
    this._oppGone = false;
  }

  get active() { return this.phase !== 'idle'; }
  canDealDamage() { return this.phase === 'fighting'; }

  // ---------- matchmaking ----------
  startMatchmaking() {
    if (this.active) return;
    if (!window.Peer) {
      this.game.menus.setMatchStatus('NO CONNECTION — DUEL NEEDS INTERNET');
      this.game.menus.show('match');
      return;
    }
    this.phase = 'searching';
    this._oppGone = false;
    this.game.menus.show('match');
    this.net = new DuelNet();
    this.net.onStatus = (s) => this.game.menus.setMatchStatus(s);
    this.net.onMessage = (m) => this._onMessage(m);
    this.net.onDisconnect = () => this._onPeerLost();
    this.net.onMatched = (role) => {
      this.role = role;
      this._toSelect();
    };
    this.net.findMatch();
  }

  cancelMatchmaking() {
    this._teardownNet();
    this.phase = 'idle';
    this.game.menus.show('mp');   // duel lives inside the multiplayer menu now
  }

  _toSelect() {
    this.phase = 'select';
    this.myClass = null;
    this.oppClass = null;
    this._rematchMe = false;
    this._rematchThem = false;
    this.score = { me: 0, opp: 0 };
    this.round = 0;
    this.game.state = 'select';
    this.game.menus.showDuelSelect();
  }

  pickClass(classId) {
    if (this.phase !== 'select' || this.myClass) return;
    this.myClass = classId;
    this.net.send({ t: 'pick', c: classId });
    this.game.menus.markDuelPicked();
    this._maybeStart();
  }

  _maybeStart() {
    // the host fires the starting gun once both fighters are locked in —
    // and rolls the battleground + hazard seed the whole match plays on
    if (this.role === 'host' && this.myClass && this.oppClass) {
      this.mapId = randomMapId();
      this.seed = (Math.random() * 1e9) | 0;
      this.net.send({ t: 'start', map: this.mapId, seed: this.seed });
      this._beginMatch();
    }
  }

  _beginMatch() {
    const g = this.game;
    g.mode = 'duel';
    g.startDuel(this.myClass, this.mapId || 'classic', this.seed || 1);
    this.avatar = new DuelOpponent(g, this, this.oppClass);
    g.enemies.push(this.avatar);
    g.projectiles.onSpawn = (o) => this._sendProjectile(o);
    this._fxBuf = [];
    g.playerFx = recordingEffects(g.effects, this._fxBuf);   // my ability VFX -> their screen
    this._baseWalkSpeed = g.player.walkSpeed;
    this._poison = null;
    this._slowT = 0;
    this._recvAge = 0;
    this._startRound(1);
  }

  _startRound(n) {
    const g = this.game;
    this.round = n;
    this.phase = 'countdown';
    this._cdT = 3.6;
    this._cdLast = 99;
    this._committed = false;
    this._roundResult = null;
    this._poison = null;
    this._slowT = 0;

    g.projectiles.clear();
    g.resetCombatState();
    killFxProps(this.avatar);   // stale rival props (orb, anchor) don't cross rounds
    if (this._fxBuf) this._fxBuf.length = 0;

    // fresh hazard schedule per round, still seed-locked across both clients;
    // clock rewind puts orbiting platforms back under the spawn points
    g.world.clock = 0;
    g.world.resetHazards((this.seed || 1) + n);

    const table = g.world.mapDef.spawns.duel;
    const mine = this.role === 'host' ? table[0] : table[1];
    const theirs = this.role === 'host' ? table[1] : table[0];
    g.player.respawn();
    g.player.position.set(mine[0], mine[1], mine[2]);
    g.player.yaw = mine[3];
    g.player.pitch = 0;
    g.player.freeze = true;
    this.avatar.respawn(_v1.set(theirs[0], theirs[1], theirs[2]), theirs[3]);

    g.hud.setDuelInfo(this.round, this.score.me, this.score.opp);
    g.hud.announce(n === 1 ? g.world.mapDef.name : `ROUND ${n}`, '');
  }

  // ---------- per-frame (driven from Game.tick, all states) ----------
  update(dt) {
    if (!this.active) return;
    const g = this.game;

    if (this.phase === 'countdown') {
      this._sendState(dt);
      this._cdT -= dt;
      const sec = Math.ceil(this._cdT);
      if (sec !== this._cdLast && sec >= 1 && sec <= 3) {
        this._cdLast = sec;
        g.hud.announce(String(sec), 'sub');
        g.audio?.play('chargeStart');
      }
      if (this._cdT <= 0) {
        this.phase = 'fighting';
        g.player.freeze = false;
        g.hud.announce('FIGHT!', '');
        g.audio?.play('runStart');
      }
      this._checkStale(dt);
      return;
    }

    if (this.phase === 'fighting') {
      this._sendState(dt);
      this._checkStale(dt);

      // incoming slow effect
      if (this._slowT > 0) {
        this._slowT -= dt;
        g.player.walkSpeed = this._baseWalkSpeed * 0.55;
      } else {
        g.player.walkSpeed = this._baseWalkSpeed;
      }

      // incoming void-poison DoT (applied directly: must never trigger the
      // post-hit invulnerability window, or poison would block real hits)
      if (this._poison && g.player.alive) {
        this._poison.t -= dt;
        g.player.health -= this._poison.dps * dt;
        g.player.lastDamagedAt = g.simTime;
        if (Math.random() < dt * 6) {
          g.hud.flash('rgba(150, 60, 220, 0.10)', 0.15);
        }
        if (g.player.health <= 0) {
          g.player.health = 0;
          g.player.alive = false;
          if (g.player.onDeath) g.player.onDeath();
        }
        if (this._poison.t <= 0) this._poison = null;
      }

      // out of combat 10s -> 1 hp/s trickle
      if (g.player.alive && g.simTime - (g.player.lastDamagedAt ?? -999) >= 10) {
        g.player.heal(1 * dt);
      }

      // falling into the void loses the round (before the solo-mode reset at -110)
      if (g.player.alive && g.player.position.y < -95) {
        g.player.alive = false;
        this.localDied();
      }
      return;
    }

    if (this.phase === 'roundover') {
      this._sendState(dt);
      this._checkStale(dt);
      // short grace so a mutual kill resolves as a draw on both screens
      if (!this._committed) {
        this._commitT -= dt;
        if (this._commitT <= 0) this._commitRound();
      } else {
        this._overT -= dt;
        if (this._overT <= 0) {
          if (this.score.me >= ROUNDS_TO_WIN || this.score.opp >= ROUNDS_TO_WIN) {
            this._matchOver(this.score.me > this.score.opp,
              this.score.me > this.score.opp ? 'YOU TOOK THE SKY' : 'THE SKY FALLS TO YOUR RIVAL');
          } else {
            this._startRound(this.round + 1);
          }
        }
      }
      return;
    }
  }

  _sendState(dt) {
    this._sendT -= dt;
    if (this._sendT > 0) return;
    this._sendT = SEND_INTERVAL;
    const g = this.game;
    const p = g.player;
    this.net.send({
      t: 's',
      p: [+p.position.x.toFixed(2), +p.position.y.toFixed(2), +p.position.z.toFixed(2)],
      v: [+p.vel.x.toFixed(2), +p.vel.y.toFixed(2), +p.vel.z.toFixed(2)],
      yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3),
      g: p.grounded ? 1 : 0,
      d: p.dashTimer > 0 ? 1 : 0,
      c: g.combat && g.combat.charging ? 1 : 0,
      hp: Math.round(p.health), mh: p.maxHealth, sh: Math.round(p.shield),
    });
    // batched ability VFX ride the same 20Hz cadence
    if (this._fxBuf && this._fxBuf.length) {
      this.net.send({ t: 'fx', l: this._fxBuf.splice(0) });
    }
  }

  _checkStale(dt) {
    this._recvAge += dt;
    if (this._recvAge > 12) this._onPeerLost();
  }

  // ---------- messages ----------
  _onMessage(m) {
    this._recvAge = 0;
    switch (m.t) {
      case 'pick':
        this.oppClass = m.c;
        this.game.menus.setDuelOppStatus('RIVAL LOCKED IN');
        this._maybeStart();
        break;
      case 'start':
        if (this.role === 'guest' && this.phase === 'select' && this.myClass && this.oppClass) {
          this.mapId = m.map || 'classic';
          this.seed = m.seed || 1;
          this._beginMatch();
        }
        break;
      case 's':
        if (this.avatar) this.avatar.applySnapshot(m);
        break;
      case 'cast':
        if (this.avatar && this.avatar.alive) this.avatar.playAttack();
        break;
      case 'proj':
        this._spawnRemoteProjectile(m.o);
        break;
      case 'fx':
        if (this.avatar) applyFx(this.game, m.l, this.avatar);
        break;
      case 'hit':
        this._applyHit(m);
        break;
      case 'died':
        this._onOppDied(m.r);
        break;
      case 'rem':
        this._rematchThem = true;
        this.game.menus.setDuelEndNote('RIVAL WANTS A REMATCH');
        this._maybeRematch();
        break;
      case 'bye':
        this._onPeerLost();
        break;
    }
  }

  // DuelOpponent hook (shared with the FFA mode, which routes per-target)
  sendHitFor(avatar, dmg, knockback, freeze, poison, slow) {
    this.sendHit(dmg, knockback, freeze, poison, slow);
  }

  // my attack landed on their avatar in my world -> tell them
  sendHit(dmg, knockback, freeze, poison, slow) {
    this.net.send({
      t: 'hit',
      d: +dmg.toFixed(1),
      k: knockback ? [+knockback.x.toFixed(2), +knockback.y.toFixed(2), +knockback.z.toFixed(2)] : null,
      f: freeze || 0,
      po: poison ? { dps: poison.dps, t: poison.t } : null,
      sl: slow || 0,
    });
  }

  _applyHit(m) {
    if (this.phase !== 'fighting') return;
    const g = this.game;
    const p = g.player;
    if (!p.alive) return;
    const src = this.avatar ? this.avatar.position : null;
    p.takeDamage(m.d, src, { pierceInvuln: true });
    // the hit lands ON me: show it landing (their client only shows their side)
    const c = p.position.clone(); c.y += 1.1;
    g.effects.impactBurst(c, { color: 0xffb0a0, size: Math.min(3.2, 1.3 + m.d * 0.05) });
    g.effects.burst(c, { count: 8 + Math.min(14, Math.round(m.d * 0.4)), color: 0xff8877, speed: 7, size: 0.22, life: 0.3 });
    if (m.k) p.applyKnockback(new THREE.Vector3(m.k[0], m.k[1], m.k[2]));
    if (m.f > 0) p.root(m.f);
    if (m.sl > 0) this._slowT = Math.max(this._slowT, m.sl);
    if (m.po) {
      this._poison = {
        t: Math.max(this._poison ? this._poison.t : 0, m.po.t),
        dps: Math.max(this._poison ? this._poison.dps : 0, m.po.dps),
      };
    }
  }

  // cosmetic copy of the opponent's projectile in my world
  _sendProjectile(o) {
    if (this.phase !== 'fighting' && this.phase !== 'roundover') return;
    this.net.send({
      t: 'proj',
      o: {
        p: [+o.pos.x.toFixed(2), +o.pos.y.toFixed(2), +o.pos.z.toFixed(2)],
        v: [+o.vel.x.toFixed(2), +o.vel.y.toFixed(2), +o.vel.z.toFixed(2)],
        color: o.color, coreColor: o.coreColor, size: o.size, radius: o.radius,
        gravity: o.gravity || 0, life: o.life, aoe: o.aoe || 0,
      },
    });
  }

  _spawnRemoteProjectile(o) {
    if (!o || !this.game.combat) return;
    this.game.projectiles.spawn({
      pos: new THREE.Vector3(o.p[0], o.p[1], o.p[2]),
      vel: new THREE.Vector3(o.v[0], o.v[1], o.v[2]),
      owner: 'remote', damage: 0, knockback: 0,
      color: o.color, coreColor: o.coreColor, size: o.size, radius: o.radius,
      gravity: o.gravity, life: Math.min(o.life ?? 3.5, 6), aoe: o.aoe,
    });
  }

  notifyCast(slot, power) {
    if (!this.active || !this.net) return;
    this.net.send({ t: 'cast', slot, p: power || 0 });
  }

  // ---------- deaths & rounds ----------
  localDied() {
    if (this.phase !== 'fighting') return;
    this.phase = 'roundover';
    this._roundResult = 'loss';
    this._commitT = 0.7;
    this._committed = false;
    this.net.send({ t: 'died', r: this.round });
  }

  _onOppDied(r) {
    if (this.phase === 'fighting') {
      this.phase = 'roundover';
      this._roundResult = 'win';
      this._commitT = 0.7;
      this._committed = false;
      if (this.avatar) this.avatar.die();
    } else if (this.phase === 'roundover' && r === this.round && this._roundResult === 'loss') {
      // we both died within the grace window: draw, replay the round
      this._roundResult = 'draw';
      if (this.avatar) this.avatar.die();
    }
  }

  _commitRound() {
    this._committed = true;
    this._overT = 2.6;
    const g = this.game;
    if (this._roundResult === 'win') {
      this.score.me++;
      g.hud.announce('ROUND WON', '');
      g.hud.flash('rgba(120, 220, 140, 0.14)', 0.4);
      g.audio?.play('waveClear');
    } else if (this._roundResult === 'loss') {
      this.score.opp++;
      g.hud.announce('ROUND LOST', 'sub');
      g.audio?.play('playerDeath');
    } else {
      g.hud.announce('DOUBLE K.O. — REMATCH', 'sub');
    }
    g.hud.setDuelInfo(this.round, this.score.me, this.score.opp);
  }

  _matchOver(won, reason) {
    const g = this.game;
    this.phase = 'matchover';
    g.player.freeze = true;
    document.exitPointerLock?.();
    g.state = 'select'; // menu-style orbit camera behind the end screen
    g.hud.hide();
    g.menus.showDuelEnd(won, this.score.me, this.score.opp, reason, !this._oppGone);
    g.audio?.play(won ? 'waveClear' : 'playerDeath');
  }

  requestRematch() {
    if (this.phase !== 'matchover' || this._oppGone || this._rematchMe) return;
    this._rematchMe = true;
    this.net.send({ t: 'rem' });
    this.game.menus.setDuelEndNote('WAITING FOR RIVAL…');
    this._maybeRematch();
  }

  _maybeRematch() {
    if (this.phase === 'matchover' && this._rematchMe && this._rematchThem) {
      this._disposeAvatar();
      this._toSelect();
    }
  }

  // ---------- exits ----------
  _onPeerLost() {
    if (this.phase === 'idle') return;
    this._oppGone = true;
    if (this.phase === 'searching') return; // net layer keeps retrying
    if (this.phase === 'select') {
      // never got to fight: quietly go find someone else
      this._teardownNet();
      this.phase = 'idle';
      this.game.state = 'menu';
      this.startMatchmaking();
      return;
    }
    if (this.phase === 'matchover') {
      this.game.menus.setDuelEndNote('RIVAL LEFT — REMATCH UNAVAILABLE');
      return;
    }
    // mid-match: victory by disconnect
    this._matchOver(true, 'YOUR RIVAL FLED THE SKY');
  }

  // player chose to leave (forfeit button / menu button)
  leave() {
    if (this.net) this.net.send({ t: 'bye' });
    this._teardownNet();
    this._disposeAvatar();
    this.phase = 'idle';
    this.role = null;
    const g = this.game;
    g.projectiles.onSpawn = null;
    g.playerFx = null;
    if (this._baseWalkSpeed) g.player.walkSpeed = this._baseWalkSpeed;
    g.mode = 'solo';
    g.toMenu();
  }

  _disposeAvatar() {
    if (!this.avatar) return;
    killFxProps(this.avatar);
    const idx = this.game.enemies.indexOf(this.avatar);
    if (idx >= 0) this.game.enemies.splice(idx, 1);
    this.avatar.dispose();
    this.avatar = null;
  }

  _teardownNet() {
    if (this.net) { this.net.destroy(); this.net = null; }
  }
}
