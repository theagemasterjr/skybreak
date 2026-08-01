import * as THREE from 'three';
import { CLASSES } from './classes.js';

// ---------------------------------------------------------------------------
// BotBrain: the local pilot for a DuelOpponent in singleplayer bot duels.
// Perception -> intention -> movement/attack, ticked every frame. It flies
// like a player (double jump, air dash, momentum), aims like a human
// (reaction delay + smoothed error + target leading), fights with a
// class-flavored kit, and respects overtime hazards.
//
// Damage OUT: projectiles with owner 'enemy' + direct player.takeDamage for
// melee. Damage IN arrives via BotDuel.sendHitFor (owner contract).
// ---------------------------------------------------------------------------

const GRAVITY = 30;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _grav = new THREE.Vector3(0, -1, 0);
const _up = new THREE.Vector3(0, 1, 0);

export const BOT_DIFFICULTY = {
  rookie:    { reaction: 0.45, aimErr: 0.14,  dodge: 0.25, lead: 0.3, cdMul: 1.35, predictive: false },
  duelist:   { reaction: 0.28, aimErr: 0.08,  dodge: 0.55, lead: 0.7, cdMul: 1.0,  predictive: false },
  nightmare: { reaction: 0.15, aimErr: 0.035, dodge: 0.85, lead: 1.0, cdMul: 0.85, predictive: true },
};

// ---- kit factories ----
// bolt: ranged basic. Fires an enemy projectile at the (predicted) player.
function bolt(dmg, speed, cd, color, poison = null) {
  return {
    range: 34, cd,
    fire(b) {
      const from = b.muzzle();
      const dir = b.aimAtPlayer(speed);
      b.g.projectiles.spawn({
        pos: from, vel: dir.multiplyScalar(speed),
        owner: 'enemy', damage: dmg, color, size: 0.4,
        gravity: 0, life: 4, knockback: 6, poison,
      });
      b.g.audio?.play('enemyShot');
    },
  };
}

// melee: close-range swipe with knockback (mirrors Enemy.meleeStrike).
function melee(dmg, range, cd) {
  return {
    range: range + 0.5, cd,
    fire(b) {
      const g = b.g;
      _v1.copy(g.player.position).setY(g.player.position.y + 0.9);
      if (b.avatar.center(_v2).distanceTo(_v1) < range + 0.6) {
        if (g.player.takeDamage(dmg, b.avatar.position, {})) {
          const push = _v1.copy(g.player.position).sub(b.avatar.position).setY(0).normalize().multiplyScalar(9);
          push.y = 5;
          g.player.applyKnockback(push);
        }
      }
      g.effects.glow(b.avatar.center(_v2).clone(), { color: 0xff7a5a, size: 1.3, life: 0.16 });
      g.audio?.play('swipe');
    },
  };
}

export class BotBrain {
  constructor(game, owner, avatar, difficulty) {
    this.g = game;
    this.owner = owner;
    this.avatar = avatar;
    this.diff = BOT_DIFFICULTY[difficulty] || BOT_DIFFICULTY.duelist;
    this.stats = CLASSES[avatar.classId].stats;
    this.kit = BOT_KITS[avatar.classId] || BOT_KITS.mage;
    this.vel = new THREE.Vector3();
    avatar.brainVel = this.vel;         // hazards (the Maw) shove the bot through this
    this.reset();
  }

  reset() {
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.jumpsLeft = 2;
    this.dashCharges = this.stats.maxDashes || 3;
    this.dashRecharge = 0;
    this.dashT = 0;
    this.dashDir = new THREE.Vector3();
    this.intent = 'engage';
    this.thinkT = 0.5;
    this.reactT = 0;
    this.knownPos = new THREE.Vector3().copy(this.g.player.position);
    this.knownVel = new THREE.Vector3();
    this.aimErr = new THREE.Vector3();
    // opening grace: the bot doesn't dump its whole kit at the bell
    this.cds = { basic: 1, gap: 3, burst: 4, escape: 2, ult: 12 };
    this.hesitateT = 0;
    this.strafeSign = 1;
    this.hopT = 1 + Math.random();
    this._spinT = 0;
    this._chargingT = 0;
    this._chargedFire = null;
    this._queue = [];       // delayed sub-attacks (volleys)
    this._airT = 0;
  }

  // ---------- helpers ----------
  muzzle() {
    const m = this.avatar.center(_v1).clone();
    m.y += 0.3;
    return m;
  }

  // predicted + error-smeared direction from the muzzle to the player
  aimAtPlayer(projSpeed) {
    const from = this.muzzle();
    const to = _v2.copy(this.knownPos);
    to.y += 1.1;
    if (projSpeed) {
      const eta = from.distanceTo(to) / projSpeed;
      to.addScaledVector(this.knownVel, eta * this.diff.lead);
    }
    return to.add(this.aimErr).sub(from).normalize().clone();
  }

  _hasLos() {
    if (this.g.playerInSmoke?.()) {
      return this.avatar.position.distanceTo(this.g.player.position) < 4;
    }
    return true;
  }

  _sideDir() {
    _v1.copy(this.knownPos).sub(this.avatar.position).setY(0);
    if (_v1.lengthSq() < 0.01) _v1.set(1, 0, 0);
    return _v2.crossVectors(_v1.normalize(), _up).normalize()
      .multiplyScalar(Math.random() < 0.5 ? 1 : -1).clone();
  }

  _jump(speed) {
    this.g.world.gravityAt(this.avatar.position, _grav);
    const inward = this.vel.dot(_grav);
    if (inward > 0) this.vel.addScaledVector(_grav, -inward);
    this.vel.addScaledVector(_grav, -speed);
    this.grounded = false;
  }

  _dash(dir) {
    if (this.dashCharges <= 0 || this.dashT > 0) return;
    this.dashCharges--;
    this.dashT = 0.26;
    this.dashDir.copy(dir).normalize();
    this.grounded = false;
    this.g.effects.glow(this.avatar.center(_v1).clone(), { color: 0xff6655, size: 1.1, life: 0.15 });
  }

  // ---------- perception / decisions ----------
  _maybeDodge() {
    if (Math.random() > this.diff.dodge) return;
    const g = this.g, a = this.avatar;
    let threat = !!(g.player.alive && g.combat?.charging);
    for (const pr of g.projectiles.list) {
      if (pr.owner !== 'player' || pr.dead) continue;
      _v1.copy(a.position).setY(a.position.y + 1).sub(pr.pos);
      const t = _v1.dot(pr.vel) / (pr.vel.lengthSq() || 1);
      if (t > 0 && t < 0.6 && _v1.addScaledVector(pr.vel, -t).length() < 3) { threat = true; break; }
    }
    // nightmare: sometimes moves before the shot even fires
    if (this.diff.predictive && g.input?.attackDown?.() && Math.random() < 0.4) threat = true;
    if (threat) this._dash(this._sideDir());
  }

  _hazardDanger(pos) {
    const w = this.g.world, ot = w.overtime;
    let danger = 0;
    const h = w.hazards;
    if (h && h.pullR !== undefined) {                 // the Maw
      const d = pos.distanceTo(h.center);
      if (d < h.pullR + 4) danger = Math.max(danger, 1 - d / (h.pullR + 4));
    }
    if (ot?.started) {
      if (ot.R !== undefined) {                       // the Storm: outside = death
        if (Math.hypot(pos.x, pos.z) > ot.R - 3) danger = Math.max(danger, 0.8);
      }
      if (ot.lavaY !== undefined && pos.y < ot.lavaY + 6) danger = Math.max(danger, 0.9);
      if (ot.strikes) {
        for (const s of ot.strikes.list) {            // telegraphed blasts
          if (pos.distanceTo(s.pos) < s.o.r + 2) { danger = Math.max(danger, 0.85); break; }
        }
      }
    }
    return danger;
  }

  _safeGoal() {
    const w = this.g.world, ot = w.overtime;
    if (w.gravityFlipped) {
      // the fight lives on the Canopy now
      const cp = w.gravPlates.find((p) => p.canopy);
      if (cp) return _v3.copy(cp.center).addScaledVector(cp.normal, 2).clone();
    }
    if (ot?.started) {
      if (ot.R !== undefined) {
        // storm: run for the eye
        return _v3.set(0, 6, 0).multiplyScalar(1).clone().setLength(Math.max(0.1, ot.R * 0.4)).setY(6);
      }
      if (ot.lavaY !== undefined) {
        // lava: highest island top
        let best = null;
        for (const isl of w.islands) if (!best || isl.topY > best.topY) best = isl;
        if (best) return new THREE.Vector3(best.x, best.topY + 2, best.z);
      }
      const h = w.hazards;
      if (h && h.pullR !== undefined) {
        // maw: directly away from the pull
        return _v3.copy(this.avatar.position).sub(h.center).setY(0).normalize()
          .multiplyScalar(h.pullR + 12).add(h.center).setY(this.avatar.position.y).clone();
      }
      if (ot.strikes && ot.strikes.list.length) {
        const s = ot.strikes.list[0];
        return _v3.copy(this.avatar.position).sub(s.pos).setY(0).normalize()
          .multiplyScalar(s.o.r + 4).add(this.avatar.position).clone();
      }
    }
    // default: nearest island top near the player
    let best = null, bd = Infinity;
    for (const isl of w.islands) {
      const d = Math.hypot(isl.x - this.knownPos.x, isl.z - this.knownPos.z);
      if (d < bd) { bd = d; best = isl; }
    }
    if (best) return new THREE.Vector3(best.x, best.topY + 2, best.z);
    return this.knownPos.clone();
  }

  _think() {
    const a = this.avatar;
    const hp = this.owner.botHp / this.owner.botMaxHp;
    const pHp = this.g.player.health / this.g.player.maxHealth;
    const d = a.position.distanceTo(this.knownPos);
    const danger = this._hazardDanger(a.position);
    if (danger > 0.5) this.intent = 'reposition';
    else if (pHp < 0.25 && hp > 0.3) this.intent = 'finish';
    else if (hp < 0.28 && pHp > 0.4) this.intent = 'evade';
    else this.intent = 'engage';   // engage steering closes any gap itself
    if (Math.random() < 0.3) this.strafeSign *= -1;
  }

  // ---------- movement ----------
  _move(dt) {
    const a = this.avatar;
    const toP = _v1.copy(this.knownPos).sub(a.position);
    const flat = _v2.copy(toP).setY(0);
    const d = flat.length() || 0.001;
    flat.normalize();
    const side = _v3.crossVectors(flat, _up).normalize().multiplyScalar(this.strafeSign);
    const wish = new THREE.Vector3();
    const isMelee = this.kit.range < 8;
    if (this.intent === 'engage' || this.intent === 'finish') {
      // melee kits actually close the gap; ranged kits keep their distance
      const want = (this.intent === 'finish' ? 0.5 : 1)
        * (isMelee ? this.kit.range * 0.55 : this.kit.range);
      const gain = isMelee ? 0.7 : 0.25;
      wish.addScaledVector(flat, (d - want) * gain)
          .addScaledVector(side, isMelee ? 4 : 6);
    } else if (this.intent === 'evade') {
      wish.addScaledVector(flat, -8).addScaledVector(side, 5);
    } else {
      const goal = this._safeGoal();
      wish.copy(goal).sub(a.position).setY(0);
      if (wish.length() > 1) wish.normalize().multiplyScalar(10);
      // dash toward safety when the ground is about to kill us
      if (this._hazardDanger(a.position) > 0.7 && this.dashCharges > 0 && Math.random() < dt * 3) {
        this._dash(wish.clone().setY(0.3).normalize());
      }
    }
    // land lookahead: never strafe blindly out over the void — if the spot
    // we're drifting toward has no ground, steer toward safe land instead,
    // and take the edge as a deliberate JUMP so gap crossings are flights,
    // not stumbles (recovery flight carries us the rest of the way)
    this._gapAhead = false;
    if (!this.g.world.gravityFlipped) {
      _v1.set(a.position.x + (this.vel.x + wish.x) * 0.6,
        a.position.y, a.position.z + (this.vel.z + wish.z) * 0.6);
      const ahead = this.g.world.groundHeightBelow(_v1.x, _v1.z, a.position.y + 4, 0, 200);
      if (ahead === null) {
        this._gapAhead = true;
        const goal = this._safeGoal();
        wish.copy(goal).sub(a.position).setY(0);
        if (wish.length() > 1) wish.normalize().multiplyScalar(11);
      }
    }
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, 3.2 * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, 3.2 * dt);
    this._verticality(dt, toP);
  }

  _verticality(dt, toP) {
    const w = this.g.world, a = this.avatar;
    if (w.gravityFlipped) return;   // the Canopy's field handles "down" now
    if (this.grounded) {
      // stay aerial: hop often, harder when the player holds high ground —
      // and ALWAYS jump off an edge we're about to cross (height buys the
      // crossing; the recovery flight finishes it)
      this.hopT -= dt;
      if (this._gapAhead || toP.y > 2 || this.hopT <= 0) {
        this._jump(13);
        this.jumpsLeft = 1;
        this.hopT = 0.9 + Math.random() * 1.4;
      }
    } else {
      this._airT += dt;
      // double jump to chase height / arrest a bad fall
      if (this.jumpsLeft > 0 && this.vel.y < -4 && toP.y > 1 && Math.random() < dt * 4) {
        this._jump(12);
        this.jumpsLeft--;
      }
      // void recovery: the INSTANT there's no ground anywhere below, fight
      // back toward land — arrest the fling, dash, then climb hard. (The
      // player gets a free dash refill in the recover zone; the bot gets the
      // same deal, once per fall.)
      this._recovering = false;
      const ground = w.groundHeightBelow(a.position.x, a.position.z, a.position.y + 2, 0, 400);
      if (ground === null) {
        this._recovering = true;
        if (!this._recoverAssistUsed) {
          this._recoverAssistUsed = true;
          this.dashCharges = this.stats.maxDashes || 3;
        }
        const goal = this._safeGoal();
        const dir = _v1.copy(goal).sub(a.position).setY(0);
        const dh = dir.length();
        dir.normalize();
        if (this.dashT <= 0) {
          // kill outward momentum fast, steer home
          this.vel.x += (dir.x * 14 - this.vel.x) * Math.min(1, 6 * dt);
          this.vel.z += (dir.z * 14 - this.vel.z) * Math.min(1, 6 * dt);
          if (this.dashCharges > 0 && this.vel.y < -10) {
            const up = _v2.copy(dir); up.y = 0.85;
            this._dash(up.normalize());
          } else if (a.position.y < goal.y + 2) {
            // sustained climb, stronger the further from safety we are
            this.vel.y = Math.max(this.vel.y, Math.min(14, 6 + dh * 0.25));
          }
        }
      } else {
        this._recoverAssistUsed = false;
      }
    }
  }

  // ---------- combat ----------
  _fight(dt) {
    const kit = this.kit, d = this.avatar.position.distanceTo(this.knownPos);
    if (this._chargingT > 0) {
      this._chargingT -= dt;
      if (this._chargingT <= 0 && this._chargedFire) {
        const fn = this._chargedFire;
        this._chargedFire = null;
        fn();
        this.avatar.playAttack();
        this.hesitateT = 0.4 + Math.random() * 0.5;
      }
      return;   // committed to the wind-up
    }
    if (!this._hasLos()) return;
    // basic
    if (this.cds.basic <= 0 && d < kit.basic.range) {
      this.cds.basic = kit.basic.cd * this.diff.cdMul * (0.8 + Math.random() * 0.4);
      kit.basic.fire(this);
      this.avatar.playAttack();
    }
    // gap closer
    if (kit.gap && this.cds.gap <= 0 && d > kit.gap.minD && d < kit.gap.maxD
        && (this.intent === 'engage' || this.intent === 'finish')) {
      this.cds.gap = kit.gap.cd * this.diff.cdMul;
      kit.gap.use(this);
    }
    // burst
    if (kit.burst && this.cds.burst <= 0 && d < kit.range * 1.3
        && (this.intent !== 'evade') && Math.random() < 0.6) {
      this.cds.burst = kit.burst.cd * this.diff.cdMul;
      kit.burst.use(this);
      this.avatar.playAttack();
    }
    // escape
    if (kit.escape && this.cds.escape <= 0
        && this.owner.botHp / this.owner.botMaxHp < (kit.escape.hpBelow ?? 0.33)
        && d < 12) {
      this.cds.escape = kit.escape.cd * this.diff.cdMul;
      kit.escape.use(this);
    }
    // ult: saved for a real opening
    const p = this.g.player;
    const opening = p.rootTimer > 0 || p.health < p.maxHealth * 0.4
      || (this.g.combat?.charging && this.diff.predictive);
    if (kit.ult && this.cds.ult <= 0 && opening && d < kit.range * 1.6) {
      this.cds.ult = kit.ult.cd * this.diff.cdMul;
      kit.ult.use(this);
    }
  }

  // ---------- verbs ----------
  _vVolley({ n, dmg, speed, spread, color, interval, poison = null }) {
    for (let i = 0; i < n; i++) {
      this._queue.push({
        t: i * interval,
        fn: () => {
          const from = this.muzzle();
          const dir = this.aimAtPlayer(speed);
          dir.x += (Math.random() - 0.5) * spread;
          dir.y += (Math.random() - 0.5) * spread;
          dir.z += (Math.random() - 0.5) * spread;
          this.g.projectiles.spawn({
            pos: from, vel: dir.normalize().multiplyScalar(speed),
            owner: 'enemy', damage: dmg, color, size: 0.35,
            gravity: 0, life: 4, knockback: 5, poison,
          });
          this.g.audio?.play('enemyShot');
          this.avatar.playAttack();
        },
      });
    }
  }

  _vLunge({ dmg, kb, range }) {
    const dir = _v1.copy(this.knownPos).sub(this.avatar.position).normalize().clone();
    this._dash(dir);
    this._queue.push({
      t: 0.24,
      fn: () => {
        const g = this.g;
        if (this.avatar.position.distanceTo(g.player.position) < range + 1) {
          if (g.player.takeDamage(dmg, this.avatar.position, {})) {
            const push = _v1.copy(g.player.position).sub(this.avatar.position).setY(0).normalize().multiplyScalar(kb);
            push.y = kb * 0.5;
            g.player.applyKnockback(push);
          }
        }
        g.effects.impactBurst(this.avatar.center(_v2).clone(), { color: 0xffb0a0, size: 2 });
        g.audio?.play('swipe');
        this.avatar.playAttack();
      },
    });
  }

  _vSlam({ dmg, r, kb }) {
    const g = this.g;
    const c = this.avatar.center(_v1).clone();
    g.effects.ring(c.clone().setY(this.avatar.position.y + 0.2), { color: 0xffaa66, endRadius: r, life: 0.4, thickness: 0.5 });
    g.effects.impactBurst(c, { color: 0xffaa66, size: 3 });
    g.audio?.play('explosion');
    if (g.player.alive && g.player.position.distanceTo(this.avatar.position) < r + 0.8) {
      if (g.player.takeDamage(dmg, this.avatar.position, {})) {
        const push = _v2.copy(g.player.position).sub(this.avatar.position).setY(0).normalize().multiplyScalar(kb);
        push.y = kb * 0.7;
        g.player.applyKnockback(push);
      }
    }
    this.hesitateT = 0.5 + Math.random() * 0.5;
  }

  _vBlinkAway() {
    const away = _v1.copy(this.avatar.position).sub(this.knownPos).setY(0);
    if (away.lengthSq() < 0.01) away.set(1, 0, 0);
    away.normalize();
    away.y = 0.55;
    this.g.effects.burst(this.avatar.center(_v2).clone(), { count: 14, color: 0xaaddff, speed: 6, size: 0.25, life: 0.3 });
    this._dash(away.normalize());
    this.dashT = 0.34;   // an extra-long escape dash
  }

  _vBigShot({ dmg, speed, size, aoe, color, chargeT }) {
    this._chargingT = chargeT;
    this._chargedFire = () => {
      const from = this.muzzle();
      const dir = this.aimAtPlayer(speed);
      this.g.projectiles.spawn({
        pos: from, vel: dir.multiplyScalar(speed),
        owner: 'enemy', damage: dmg, color, size,
        gravity: 0, life: 5, knockback: 14, aoe,
      });
      this.g.audio?.play('enemyShot');
    };
  }

  // ---------- physics ----------
  _physics(dt) {
    const w = this.g.world, a = this.avatar;
    const frozen = this.owner._botFrozenT > 0;
    const gMul = w.gravityAt(a.position, _grav);
    const prevY = a.position.y;

    if (this.dashT > 0) {
      this.dashT -= dt;
      const t = Math.max(0, this.dashT / 0.26);
      const speed = (this.stats.dashSpeed || 34) * (0.55 + 0.45 * t);
      this.vel.copy(this.dashDir).multiplyScalar(speed);
    } else {
      this.vel.addScaledVector(_grav, GRAVITY * (this.stats.gravityScale || 1) * gMul * dt);
      // soft horizontal speed cap
      const maxH = (this.stats.walkSpeed || 11) * (this.owner._botSlowT > 0 ? 0.55 : 1) * 1.15;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > maxH) {
        const k = Math.max(maxH / hs, 1 - 3 * dt);
        this.vel.x *= k;
        this.vel.z *= k;
      }
    }
    if (frozen) { this.vel.x = 0; this.vel.z = 0; }

    // hard fling cap: player knockback can shove the bot, never rocket it
    // across the whole map and into the void
    const flingH = Math.hypot(this.vel.x, this.vel.z);
    if (this.dashT <= 0 && flingH > 30) {
      this.vel.x *= 30 / flingH;
      this.vel.z *= 30 / flingH;
    }
    if (this.vel.y < -55) this.vel.y = -55;

    a.position.addScaledVector(this.vel, dt);

    // dash recharge (fast on the ground, slow in the air — like the player)
    const maxDashes = this.stats.maxDashes || 3;
    if (this.dashCharges < maxDashes) {
      this.dashRecharge += dt * (this.grounded ? 2.1 : 0.6);
      if (this.dashRecharge >= 1) { this.dashRecharge = 0; this.dashCharges++; }
    }

    // ground landing (heightfield), only while falling in normal gravity
    this.grounded = false;
    if (!w.gravityFlipped) {
      const ground = w.groundHeightBelow(
        a.position.x, a.position.z, Math.max(prevY, a.position.y), 0,
        this._wasGrounded ? 0.75 : 0.05
      );
      if (ground !== null && a.position.y <= ground + 0.001 + (this._wasGrounded ? 0.6 : 0) && this.vel.y <= 0.01) {
        a.position.y = ground;
        this.vel.y = 0;
        this.grounded = true;
        this.jumpsLeft = 2;
        this._airT = 0;
      }
    }
    // gravity-plate landing (belt): land on the pulling face, front side only
    for (const pl of w.gravPlates || []) {
      _v1.copy(a.position).sub(pl.center);
      const h = _v1.dot(pl.normal);
      if (Math.abs(_v1.dot(pl.t1)) > pl.w / 2 + 0.2 || Math.abs(_v1.dot(pl.t2)) > pl.d / 2 + 0.2) continue;
      if (h > -0.05 && h < 0.6) {
        const into = this.vel.dot(pl.normal);
        a.position.addScaledVector(pl.normal, 0.37 - h);
        if (into < 0) this.vel.addScaledVector(pl.normal, -into);
        this.grounded = true;
        this.jumpsLeft = 2;
        this._airT = 0;
      }
    }
    this._wasGrounded = this.grounded;

    // don't stand inside the player
    _v1.copy(a.position).sub(this.g.player.position).setY(0);
    const pd = _v1.length();
    if (pd < 1.2 && pd > 0.001) a.position.addScaledVector(_v1.normalize(), (1.2 - pd));
  }

  _writeAvatar() {
    const a = this.avatar;
    a.net.pos.copy(a.position);
    a.net.vel.copy(this.vel);
    const dx = this.knownPos.x - a.position.x;
    const dz = this.knownPos.z - a.position.z;
    if (this._spinT > 0) {
      a.net.yaw += 0.12;   // victory pirouette
    } else {
      a.net.yaw = Math.atan2(-dx, -dz);
    }
    a.net.pitch = -Math.atan2(
      this.knownPos.y - a.position.y,
      Math.hypot(dx, dz) || 1
    ) * 0.6;
    a.net.grounded = this.grounded;
    a.net.dashing = this.dashT > 0 || !!this._recovering;
    a.net.charging = this._chargingT > 0;
    a.net.age = 0;
    a.hasSnapshot = true;
  }

  // ---------- ticks ----------
  update(dt) {
    const g = this.g, a = this.avatar;
    if (!a.alive) return;
    for (const k in this.cds) this.cds[k] = Math.max(0, this.cds[k] - dt);
    // queued volley shots
    for (let i = this._queue.length - 1; i >= 0; i--) {
      this._queue[i].t -= dt;
      if (this._queue[i].t <= 0) {
        const fn = this._queue[i].fn;
        this._queue.splice(i, 1);
        if (a.alive && this.owner.phase === 'fighting') fn();
      }
    }
    // perception with reaction latency
    this.reactT -= dt;
    if (this.reactT <= 0 && g.player.alive) {
      this.reactT = this.diff.reaction * (0.7 + Math.random() * 0.6);
      this.knownPos.copy(g.player.position);
      this.knownVel.copy(g.player.vel);
      this.aimErr.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .multiplyScalar(this.diff.aimErr * 20);
      this._maybeDodge();
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.4 + Math.random() * 0.4;
      this._think();
    }
    const frozen = this.owner._botFrozenT > 0;
    if (!frozen) {
      this._move(dt);
      if (this.hesitateT > 0) this.hesitateT -= dt;
      else if (g.player.alive) this._fight(dt);
    }
    this._physics(dt);
    this._writeAvatar();
  }

  // countdown / roundover: light physics + personality, no fighting
  updateIdle(dt) {
    const a = this.avatar;
    if (!a.alive) return;
    if (this._spinT > 0) this._spinT -= dt;
    // little anticipation hops and shuffles
    this.hopT -= dt;
    if (this.grounded && this.hopT <= 0) {
      this._jump(6);
      this.hopT = 1 + Math.random() * 1.2;
      this.vel.x += (Math.random() - 0.5) * 4;
      this.vel.z += (Math.random() - 0.5) * 4;
    }
    this.vel.x *= Math.exp(-2 * dt);
    this.vel.z *= Math.exp(-2 * dt);
    this._physics(dt);
    this._writeAvatar();
  }

  onRoundWon() {
    this._spinT = 1.4;
  }
}

// ---------------------------------------------------------------------------
// Class kits: each class fights with its own flavor. Numbers run ~15% under
// player-side equivalents — a bot should be beaten by skill, not stats.
// ---------------------------------------------------------------------------
const BOT_KITS = {
  mage: {
    range: 24,
    basic: bolt(9, 34, 0.5, 0xbb88ff),
    gap: null,
    burst: { cd: 7, use: (b) => b._vVolley({ n: 3, dmg: 8, speed: 38, spread: 0.05, color: 0xbb88ff, interval: 0.12 }) },
    escape: { cd: 9, hpBelow: 0.35, use: (b) => b._vBlinkAway() },
    ult: { cd: 22, use: (b) => b._vBigShot({ dmg: 30, speed: 26, size: 1.2, aoe: 5, color: 0xe8ccff, chargeT: 1.0 }) },
  },
  brawler: {
    range: 4,
    basic: melee(11, 3.2, 0.7),
    gap: { cd: 5, minD: 5, maxD: 26, use: (b) => b._vLunge({ dmg: 14, kb: 12, range: 3.5 }) },
    burst: { cd: 9, use: (b) => b._vSlam({ dmg: 18, r: 5, kb: 16 }) },
    escape: { cd: 10, hpBelow: 0.3, use: (b) => b._vBlinkAway() },
    ult: { cd: 24, use: (b) => b._vSlam({ dmg: 30, r: 8, kb: 22 }) },
  },
  reaver: {
    range: 6,
    basic: melee(12, 3.6, 0.8),
    gap: { cd: 6, minD: 5, maxD: 24, use: (b) => b._vLunge({ dmg: 15, kb: 10, range: 3.8 }) },
    burst: { cd: 10, use: (b) => b._vVolley({ n: 2, dmg: 12, speed: 30, spread: 0.04, color: 0xff5566, interval: 0.25 }) },
    escape: { cd: 11, hpBelow: 0.3, use: (b) => b._vBlinkAway() },
    ult: { cd: 26, use: (b) => b._vSlam({ dmg: 28, r: 7, kb: 20 }) },
  },
  sorcerer: {
    range: 26,
    basic: bolt(8, 30, 0.55, 0x66aaff),
    gap: null,
    burst: { cd: 9, use: (b) => b._vBigShot({ dmg: 18, speed: 24, size: 1.0, aoe: 4, color: 0x66aaff, chargeT: 0.7 }) },
    escape: { cd: 9, hpBelow: 0.35, use: (b) => b._vBlinkAway() },
    ult: { cd: 26, use: (b) => b._vBigShot({ dmg: 34, speed: 22, size: 1.4, aoe: 6, color: 0xa64dff, chargeT: 1.2 }) },
  },
  assassin: {
    range: 14,
    basic: bolt(7, 42, 0.4, 0x9a5fff, { dps: 3, t: 2 }),
    gap: { cd: 6, minD: 10, maxD: 28, use: (b) => b._vLunge({ dmg: 12, kb: 8, range: 3.2 }) },
    burst: { cd: 8, use: (b) => b._vVolley({ n: 3, dmg: 6, speed: 40, spread: 0.06, color: 0x9a5fff, interval: 0.1, poison: { dps: 3, t: 2 } }) },
    escape: { cd: 7, hpBelow: 0.4, use: (b) => b._vBlinkAway() },
    ult: { cd: 24, use: (b) => b._vVolley({ n: 5, dmg: 6, speed: 44, spread: 0.08, color: 0xc09aff, interval: 0.09, poison: { dps: 4, t: 2.5 } }) },
  },
  gambler: {
    range: 20,
    basic: bolt(8, 33, 0.5, 0xffd76a),
    gap: null,
    // the gambler bot gambles: burst is a random pull from three very
    // different payouts (local-only randomness — no sync to worry about)
    burst: {
      cd: 8,
      use: (b) => {
        const roll = Math.random();
        if (roll < 0.34) b._vVolley({ n: 4, dmg: 7, speed: 36, spread: 0.09, color: 0xffd76a, interval: 0.1 });
        else if (roll < 0.67) b._vSlam({ dmg: 16, r: 5.5, kb: 14 });
        else b._vBigShot({ dmg: 22, speed: 26, size: 1.1, aoe: 4.5, color: 0xff9a3a, chargeT: 0.8 });
      },
    },
    escape: { cd: 9, hpBelow: 0.35, use: (b) => b._vBlinkAway() },
    ult: { cd: 24, use: (b) => b._vVolley({ n: 6, dmg: 6, speed: 38, spread: 0.12, color: 0xffd76a, interval: 0.09 }) },
  },
};
