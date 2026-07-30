import * as THREE from 'three';
import { CLASSES } from './classes.js';
import { ViewModel } from './viewmodels.js';

// ---------------------------------------------------------------------------
// PlayerCombat: owns the equipped class — cooldowns, casts, viewmodel,
// delayed effects, and the ctx object ability code runs against.
// ---------------------------------------------------------------------------

const SLOT_ACTIONS = { Q: 'ability1', E: 'ability2', R: 'ability3', F: 'ability4' };

export class PlayerCombat {
  constructor(game, classId) {
    this.game = game;
    this.classDef = CLASSES[classId];
    this.viewmodel = new ViewModel(game.camera, classId);
    this.state = {};             // class-specific runtime data
    this.cooldowns = { basic: 0 };
    for (const a of this.classDef.abilities) this.cooldowns[a.slot] = 0;
    this.delays = [];
    this.lastLook = [0, 0];
    this.charging = null;        // {slot, t} while a chargeable ability is held
    this.chargeFxTimer = 0;
    this.CHARGE_TIME = 1.1;      // seconds to full charge
    this.lockT = 0;              // channel lock (Purple Nuke): no casting at all

    game.player.setClassStats(this.classDef.stats);
  }

  // ---------- ctx ----------
  _ctx() {
    const g = this.game;
    const self = this;
    return {
      player: g.player,
      camera: g.camera,
      world: g.world,
      // in multiplayer, g.playerFx records every effect for replication to rivals
      effects: g.playerFx || g.effects,
      projectiles: g.projectiles,
      audio: g.audio,
      game: g,
      viewmodel: this.viewmodel,
      enemies: () => g.enemies,

      aimDir() {
        const d = new THREE.Vector3();
        g.camera.getWorldDirection(d);
        return d;
      },
      muzzle() {
        g.camera.updateMatrixWorld();
        const p = new THREE.Vector3();
        self.viewmodel.rig.focus.getWorldPosition(p);
        return p;
      },
      rayHits(from, dir, range, radius) {
        const out = [];
        const toE = new THREE.Vector3();
        for (const e of g.enemies) {
          if (!e.alive) continue;
          toE.copy(e.position).setY(e.position.y + e.height * 0.5).sub(from);
          const t = toE.dot(dir);
          if (t < 0 || t > range) continue;
          const perpSq = toE.lengthSq() - t * t;
          const r = radius + e.radius;
          if (perpSq < r * r) out.push({ e, t });
        }
        out.sort((a, b) => a.t - b.t);
        return out.map((o) => o.e);
      },
      // Melee hitbox: an aim-aligned box in front of the player, built from the
      // FULL aim direction (yaw + pitch) so the swing extends wherever the
      // player is looking, including straight up or down. Generous band
      // perpendicular to aim so enemies slightly off-axis still get clipped.
      meleeHit(range, width = 2.8) {
        const fwd = g.player.forwardDir(true);
        const worldUp = fwd.y > 0.98 || fwd.y < -0.98
          ? new THREE.Vector3(1, 0, 0)
          : new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(fwd, worldUp).normalize();
        const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
        const origin = g.player.position.clone().add(new THREE.Vector3(0, 1.1, 0));
        const to = new THREE.Vector3();
        const out = [];
        for (const e of g.enemies) {
          if (!e.alive) continue;
          to.copy(e.position).setY(e.position.y + e.height * 0.5).sub(origin);
          const veryClose = to.lengthSq() < 1.6 * 1.6;
          const along = to.dot(fwd);
          const side = Math.abs(to.dot(right));
          const vert = Math.abs(to.dot(up));
          if (veryClose || (along > -e.radius && along < range + e.radius && side < width * 0.5 + e.radius && vert < 2.2 + e.radius)) {
            out.push(e);
          }
        }
        return out;
      },
      coneHit(range, angleDeg) {
        const aim = this.aimDir();
        const cos = Math.cos((angleDeg * Math.PI) / 180 / 2);
        const eye = g.player.eyePosition.clone();
        const to = new THREE.Vector3();
        const out = [];
        for (const e of g.enemies) {
          if (!e.alive) continue;
          to.copy(e.position).setY(e.position.y + e.height * 0.5).sub(eye);
          const d = to.length();
          if (d > range + e.radius) continue;
          to.normalize();
          if (to.dot(aim) > cos || d < 1.2) out.push(e);
        }
        return out;
      },
      sphereHit(center, radius) {
        const out = [];
        const c = new THREE.Vector3();
        for (const e of g.enemies) {
          if (!e.alive) continue;
          c.copy(e.position).setY(e.position.y + e.height * 0.5);
          if (c.distanceTo(center) < radius + e.radius) out.push(e);
        }
        return out;
      },
      aimGroundPoint(maxDist) {
        // march the aim ray until it crosses ground
        const from = g.player.eyePosition.clone();
        const dir = this.aimDir();
        const p = from.clone();
        const step = 1.2;
        for (let d = step; d <= maxDist; d += step) {
          p.copy(from).addScaledVector(dir, d);
          const ground = g.world.groundHeightBelow(p.x, p.z, p.y + 0.5, g.simTime, 0.5);
          if (ground !== null && p.y <= ground + 0.5) {
            p.y = ground;
            return p.clone();
          }
        }
        // no direct hit: try dropping from the endpoint
        const ground = g.world.groundHeightBelow(p.x, p.z, p.y, g.simTime, 0.1);
        if (ground !== null && p.y - ground < 25) {
          p.y = ground;
          return p.clone();
        }
        return null;
      },
      dealDamage(e, dmg, { knockback = null, freeze = 0, poison = null, slow = 0 } = {}) {
        e.takeDamage(dmg, { knockback, freeze, poison, slow, source: 'player' });
      },
      stallIfAirborne(d) {
        if (!g.player.grounded) g.player.airStall(d);
      },
      slowFallIfAirborne(d) {
        if (!g.player.grounded) g.player.slowFall(d);
      },
      shake(x) { g.player.shake(x); },
      delay(t, fn) { self.delays.push({ t, fn }); },
    };
  }

  tryCast(slot, chargePower = 0) {
    if (this.cooldowns[slot] > 0) return;
    const ctx = this._ctx();
    ctx.chargePower = chargePower;   // 0..1, only >0 for charged releases
    let def, cd;
    if (slot === 'basic') { def = this.classDef.basic; cd = def.cooldown; }
    else {
      def = this.classDef.abilities.find((a) => a.slot === slot);
      cd = def.cooldown;
    }
    const ok = def.execute(ctx, this.state);
    if (ok !== false) {
      // an ability may return a number to set a custom cooldown for this cast
      this.cooldowns[slot] = typeof ok === 'number' ? ok : cd;
      if (slot !== 'basic' && this.game.hud) this.game.hud.flashAbility(slot);
      if (this.game.onPlayerCast) this.game.onPlayerCast(slot, chargePower);
    } else if (this.game.hud) {
      this.game.hud.denyAbility(slot);
    }
  }

  // swirling energy while charging: growing glow + inward-spiraling sparks
  _chargeFx(dt) {
    this.chargeFxTimer -= dt;
    if (this.chargeFxTimer > 0) return;
    this.chargeFxTimer = 0.05;
    const g = this.game;
    const t = this.charging.t / this.CHARGE_TIME;
    const color = this.classDef.color;
    const ctx = this._ctx();
    const fx = ctx.effects;   // replicated in multiplayer: rivals see the wind-up
    const m = ctx.muzzle();
    fx.glow(m, { color, size: 0.4 + t * 1.6, life: 0.09 });
    // sparks converging into the muzzle
    for (let i = 0; i < 2; i++) {
      const off = new THREE.Vector3(
        (Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 2.2
      );
      const from = m.clone().add(off);
      fx.glow(from, { color, size: 0.16 + t * 0.15, life: 0.18, grow: -0.5 });
    }
    if (t >= 1 && !this.charging.fullFxDone) {
      this.charging.fullFxDone = true;
      fx.ring(m, { color, endRadius: 1.6, life: 0.3, axis: 'x', thickness: 0.2 });
      g.audio?.play('chargeFull');
      g.player.shake(0.12);
    }
  }

  update(dt, time) {
    const g = this.game;
    // cooldowns
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    // delayed callbacks
    for (let i = this.delays.length - 1; i >= 0; i--) {
      this.delays[i].t -= dt;
      if (this.delays[i].t <= 0) {
        const fn = this.delays[i].fn;
        this.delays.splice(i, 1);
        fn();
      }
    }
    // class passive update
    if (this.classDef.update) this.classDef.update(this._ctx(), dt, this.state);

    this.lockT = Math.max(0, this.lockT - dt);
    if (g.player.alive && !g.player.freeze && this.lockT <= 0) {
      // ---- charging (hold a chargeable ability key) ----
      if (this.charging) {
        const action = SLOT_ACTIONS[this.charging.slot];
        if (g.input.down(action)) {
          this.charging.t = Math.min(this.charging.t + dt, this.CHARGE_TIME);
          // hang in the air while charging — this is the whole point
          if (!g.player.grounded) g.player.airStall(0.14);
          this._chargeFx(dt);
        } else {
          const power = this.charging.t / this.CHARGE_TIME;
          const slot = this.charging.slot;
          this.charging = null;
          this.tryCast(slot, power);
        }
      }

      // basic attack: hold to autofire (not while charging)
      if (!this.charging && g.input.attackDown()) this.tryCast('basic');

      // abilities
      if (!this.charging) {
        for (const a of this.classDef.abilities) {
          if (g.input.pressed(SLOT_ACTIONS[a.slot])) {
            // an ability can veto charge-up via canStart (e.g. mid-combo); the
            // tryCast fallback lets execute() refuse it for the deny feedback
            if (a.chargeable && this.cooldowns[a.slot] <= 0 && (!a.canStart || a.canStart(this.state))) {
              this.charging = { slot: a.slot, t: 0 };
              g.audio?.play('chargeStart');
            } else {
              this.tryCast(a.slot);
            }
          }
        }
      }
    }

    this.viewmodel.update(dt, time, g.player, g.player.lastLookDX || 0, g.player.lastLookDY || 0);
  }

  dispose() {
    this.viewmodel.dispose();
  }
}
