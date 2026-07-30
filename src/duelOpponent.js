import * as THREE from 'three';
import { DUELIST_BUILDERS } from './duelistModels.js';
import { buildChampionThirdPerson } from './championAssets.js';
import { damp, clamp } from './utils.js';

// ---------------------------------------------------------------------------
// DuelOpponent: the other player's body in MY world. Implements the same
// interface enemies expose (position/radius/height/alive/takeDamage/center),
// so every class ability, melee hitbox and projectile hits it with zero
// changes to combat code. Damage is shooter-authoritative: landing a hit here
// forwards it over the network; the victim's client applies it to themselves.
//
// Position/pose come from ~20Hz network snapshots, smoothed with velocity
// extrapolation. The rig is animated procedurally from that state: run cycle,
// air pose, dash lean, charge stance, attack swings, death collapse.
// ---------------------------------------------------------------------------

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class DuelOpponent {
  // owner: any manager exposing canDealDamage() and sendHitFor(avatar, dmg,
  // knockback, freeze, poison, slow) — the 1v1 Duel or the FFA room both do.
  constructor(game, owner, classId, opts = {}) {
    this.game = game;
    this.owner = owner;
    this.classId = classId;
    this.netId = opts.netId ?? -1;    // roster player id in multiplayer rooms
    this.displayName = opts.name || null;

    // ---- enemy-compatible surface ----
    this.type = 'duelist';
    this.elite = true;              // big damage numbers on heavy hits
    this.flying = false;
    this.alive = true;
    this.readyToRemove = false;
    this.radius = 0.55;
    this.height = 1.9;
    this.position = new THREE.Vector3(0, 4, -22);
    this.vel = new THREE.Vector3();
    this.grounded = false;
    this.frozen = 0;
    this.marked = 0;
    this.slowUntil = 0;
    this.shieldedBy = null;
    this.aggro = true;
    this.s = {};

    // mirrored vitals (authoritative value comes from their client)
    this.maxHp = 100;
    this.hp = 100;
    this.shield = 0;

    // net snapshot target
    this.net = {
      pos: this.position.clone(), vel: new THREE.Vector3(),
      yaw: 0, pitch: 0, grounded: true, dashing: false, charging: false,
      age: 0,
    };
    this.hasSnapshot = false;

    // animation state
    this.runPhase = 0;
    this.attackT = 0;
    this.flashT = 0;
    this.deathT = -1;
    this.yaw = 0;
    this.visYaw = 0;

    // ---- model: GLB champion if preloaded, old procedural rig otherwise ----
    const built = buildChampionThirdPerson(classId, this.height)
      ?? (DUELIST_BUILDERS[classId] || DUELIST_BUILDERS.mage)();
    this.usesGlb = !!built.usesGlb;
    this.model = built.group;
    this.parts = built.parts;
    this.materials = built.materials;
    // readable when backlit (same trick as enemies)
    for (const m of this.materials) {
      if (m.emissive.getHex() === 0) m.emissive.copy(m.color).multiplyScalar(0.3);
    }
    // RED ENEMY HIGHLIGHT 1: warm every material toward red
    const red = new THREE.Color(0xff3b30);
    for (const m of this.materials) {
      m.emissive.lerp(red, 0.22);
      m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.55);
    }
    this.baseEmissive = this.materials.map((m) => ({ e: m.emissive.clone(), i: m.emissiveIntensity }));
    // RED ENEMY HIGHLIGHT 2: back-face hull outline around every body part
    this.outlineMat = new THREE.MeshBasicMaterial({
      color: 0xff2a1e, side: THREE.BackSide, transparent: true, opacity: 0.85,
      depthWrite: false,
    });
    const bodyMeshes = [];
    this.model.traverse((o) => { if (o.isMesh) bodyMeshes.push(o); });
    for (const mesh of bodyMeshes) {
      const outline = new THREE.Mesh(mesh.geometry, this.outlineMat);
      outline.scale.setScalar(1.07);
      mesh.add(outline);
    }
    // RED ENEMY HIGHLIGHT 3: red glow light riding the body
    this.light = new THREE.PointLight(0xff4433, 3.5, 7, 2);
    this.light.position.y = 1.2;
    this.model.add(this.light);

    this.model.position.copy(this.position);
    game.scene.add(this.model);

    // floating red hp bar + hovering marker
    const barGroup = new THREE.Group();
    this.barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x111318, depthWrite: false, transparent: true, opacity: 0.85 }));
    this.barFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff3b30, depthWrite: false, transparent: true, opacity: 0.95 }));
    this.barShield = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd76a, depthWrite: false, transparent: true, opacity: 0.9 }));
    this.barW = 1.7;
    this.barBg.scale.set(this.barW, 0.14, 1);
    this.barFg.scale.set(this.barW, 0.1, 1);
    this.barShield.scale.set(0.0001, 0.06, 1);
    this.barShield.position.y = 0.11;
    barGroup.add(this.barBg, this.barFg, this.barShield);
    this.barGroup = barGroup;
    game.scene.add(barGroup);

    // downward triangle marker so the rival reads at any distance
    const markGeo = new THREE.ConeGeometry(0.16, 0.3, 3);
    this.markMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.95 });
    this.marker = new THREE.Mesh(markGeo, this.markMat);
    this.marker.rotation.x = Math.PI;
    game.scene.add(this.marker);
  }

  // ---------- enemy interface ----------
  center(target) {
    return target.copy(this.position).setY(this.position.y + this.height * 0.5);
  }

  takeDamage(dmg, { knockback = null, freeze = 0, poison = null, slow = 0 } = {}) {
    if (!this.alive || !this.owner.canDealDamage()) return;
    this.flashT = 0.14;
    // optimistic local mirror; their next snapshot corrects it
    this.hp = Math.max(0, this.hp - dmg);
    if (this.game.onEnemyDamaged) this.game.onEnemyDamaged(this, dmg);
    if (dmg >= 25) {
      this.game.effects.impactBurst(this.center(_v1).clone(), { size: 2 + Math.min(2.5, dmg * 0.03), color: 0xffb0a0 });
      this.game.hitstop(0.045);
    }
    this.owner.sendHitFor(this, dmg, knockback, freeze, poison, slow);
  }

  // called by the duel manager when their client reports death
  die(cause) {
    if (!this.alive) return;
    this.alive = false;
    this.deathT = 0;
    this.barGroup.visible = false;
    this.marker.visible = false;
    const c = this.center(_v1).clone();
    this.game.effects.burst(c, { count: 46, color: 0xffffff, color2: 0xff6655, speed: 12, size: 0.3, life: 0.55 });
    this.game.effects.impactBurst(c, { size: 4.5, color: 0xff8877 });
    this.game.hitstop(0.12);
  }

  respawn(pos, yaw) {
    this.alive = true;
    this.deathT = -1;
    this.hp = this.maxHp;
    this.position.copy(pos);
    this.net.pos.copy(pos);
    this.net.vel.set(0, 0, 0);
    this.net.yaw = yaw;
    this.yaw = yaw;
    this.visYaw = yaw + Math.PI;
    this.barGroup.visible = true;
    this.marker.visible = true;
    this.model.visible = true;
    this.model.scale.setScalar(1);
    this.parts.hips.rotation.set(0, 0, 0);
    this.parts.hips.position.y = 0.98;
  }

  // ---------- network ----------
  applySnapshot(m) {
    this.net.pos.set(m.p[0], m.p[1], m.p[2]);
    this.net.vel.set(m.v[0], m.v[1], m.v[2]);
    this.net.yaw = m.yaw;
    this.net.pitch = m.pitch;
    this.net.grounded = !!m.g;
    this.net.dashing = !!m.d;
    this.net.charging = !!m.c;
    this.net.age = 0;
    this.maxHp = m.mh;
    this.hp = m.hp;
    this.shield = m.sh || 0;
    this.hasSnapshot = true;
    // hard snap when way off (round reset, teleport-scale corrections)
    if (this.position.distanceTo(this.net.pos) > 12) this.position.copy(this.net.pos);
  }

  playAttack() {
    this.attackT = 0.32;
  }

  // ---------- per-frame ----------
  update(dt, t) {
    const p = this.parts;

    if (!this.alive) {
      // death collapse: crumple, sink, shrink out
      if (this.deathT >= 0) {
        this.deathT += dt;
        const k = Math.min(1, this.deathT / 1.1);
        p.hips.rotation.x = -k * 1.35;
        p.hips.position.y = 0.98 - k * 0.55;
        this.model.scale.setScalar(1 - k * 0.25);
        if (this.deathT > 1.1) this.model.visible = false;
      }
      return;
    }

    // ---- position: extrapolate the last snapshot by its velocity, then damp ----
    this.net.age += dt;
    if (this.hasSnapshot) {
      const lookahead = Math.min(this.net.age, 0.25);
      _v1.copy(this.net.pos).addScaledVector(this.net.vel, lookahead);
      const k = 1 - Math.exp(-14 * dt);
      this.position.lerp(_v1, k);
      this.vel.copy(this.net.vel);
      this.grounded = this.net.grounded;
      this.yaw = this.net.yaw;
    }
    this.model.position.copy(this.position);

    // facing (models are built facing +Z; player yaw 0 faces -Z)
    const targetYaw = this.yaw + Math.PI;
    let dy = targetYaw - this.visYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.visYaw += dy * Math.min(1, 12 * dt);
    this.model.rotation.y = this.visYaw;

    // ---- animation ----
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    const runK = clamp(hSpeed / 9, 0, 1);
    if (this.attackT > 0) this.attackT -= dt;
    if (this.flashT > 0) this.flashT -= dt;

    if (this.net.dashing) {
      // dash: full-body forward lunge, legs tucked
      p.chest.rotation.x = damp(p.chest.rotation.x, 0.85, 14, dt);
      p.legL.rotation.x = damp(p.legL.rotation.x, 0.7, 12, dt);
      p.legR.rotation.x = damp(p.legR.rotation.x, -0.5, 12, dt);
      p.armL.rotation.x = damp(p.armL.rotation.x, 0.8, 12, dt);
      if (this.attackT <= 0) p.armR.rotation.x = damp(p.armR.rotation.x, 0.8, 12, dt);
      // speed streaks off the body
      this.game.effects.glow(this.center(_v2).clone(), { color: 0xff6655, size: 0.9, life: 0.18, grow: 1.5 });
    } else if (!this.grounded) {
      // airborne: legs trail, slight backward lean, arms out
      p.chest.rotation.x = damp(p.chest.rotation.x, -0.12 - this.net.pitch * 0.2, 8, dt);
      p.legL.rotation.x = damp(p.legL.rotation.x, 0.45, 8, dt);
      p.legR.rotation.x = damp(p.legR.rotation.x, -0.2, 8, dt);
      p.armL.rotation.z = damp(p.armL.rotation.z, -0.5, 8, dt);
      if (this.attackT <= 0) p.armR.rotation.x = damp(p.armR.rotation.x, -0.4, 8, dt);
    } else if (hSpeed > 1.2) {
      // run cycle
      this.runPhase += dt * (6 + hSpeed * 0.9);
      const swing = Math.sin(this.runPhase) * 0.85 * runK;
      p.legL.rotation.x = swing;
      p.legR.rotation.x = -swing;
      p.armL.rotation.x = -swing * 0.7;
      if (this.attackT <= 0) p.armR.rotation.x = swing * 0.7;
      p.armL.rotation.z = damp(p.armL.rotation.z, -0.1, 8, dt);
      p.chest.rotation.x = damp(p.chest.rotation.x, 0.14 * runK - this.net.pitch * 0.15, 10, dt);
      p.hips.position.y = 0.98 + Math.abs(Math.sin(this.runPhase)) * 0.055 * runK;
    } else {
      // idle: soft breathing sway
      p.legL.rotation.x = damp(p.legL.rotation.x, 0, 8, dt);
      p.legR.rotation.x = damp(p.legR.rotation.x, 0, 8, dt);
      p.armL.rotation.x = damp(p.armL.rotation.x, Math.sin(t * 1.6) * 0.05, 8, dt);
      if (this.attackT <= 0) p.armR.rotation.x = damp(p.armR.rotation.x, Math.sin(t * 1.6 + 1) * 0.05, 8, dt);
      p.armL.rotation.z = damp(p.armL.rotation.z, -0.06, 8, dt);
      p.chest.rotation.x = damp(p.chest.rotation.x, -this.net.pitch * 0.15 + Math.sin(t * 1.6) * 0.02, 8, dt);
      p.hips.position.y = damp(p.hips.position.y, 0.98 + Math.sin(t * 1.6) * 0.012, 8, dt);
    }

    // charge stance: weapon arm raised high, accents blaze
    if (this.net.charging && this.attackT <= 0) {
      p.armR.rotation.x = damp(p.armR.rotation.x, -2.3, 10, dt);
      if (Math.random() < 0.35) {
        p.armR.getWorldPosition(_v2);
        this.game.effects.glow(_v2, { color: 0xff7766, size: 0.6 + Math.random() * 0.5, life: 0.14 });
      }
    }

    // attack swing: sharp overhead arc that eases back
    if (this.attackT > 0) {
      const k = this.attackT / 0.32;             // 1 -> 0
      p.armR.rotation.x = k > 0.6 ? -2.4 : (-2.4 + (0.6 - k) / 0.6 * 3.3);
    }

    // aim pitch on the head
    p.head.rotation.x = -this.net.pitch * 0.55;

    // cape flutter, shard orbits, weapon shimmer
    if (p.cape) p.cape.rotation.x = 0.16 + runK * 0.5 + (this.grounded ? 0 : 0.35) + Math.sin(t * 4.2) * 0.06;
    if (p.shards) p.shards.rotation.y += dt * 2.4;
    if (p.emblem) p.emblem.rotation.y += dt * 1.8;

    // hurt flash / charge tint on emissive materials
    const flash = this.flashT > 0 ? clamp(this.flashT / 0.14, 0, 1) : 0;
    const chargeGlow = this.net.charging ? 0.6 + Math.sin(t * 14) * 0.3 : 0;
    for (let i = 0; i < this.materials.length; i++) {
      const m = this.materials[i], base = this.baseEmissive[i];
      if (flash > 0) {
        m.emissive.setRGB(1, 1, 1);
        m.emissiveIntensity = base.i + flash * 2.2;
      } else {
        m.emissive.copy(base.e);
        m.emissiveIntensity = base.i + chargeGlow;
      }
    }
    this.light.intensity = 3.5 + chargeGlow * 3 + flash * 5;

    // hp bar + marker track the head
    this.barGroup.position.copy(this.position);
    this.barGroup.position.y += this.height + 0.55;
    const frac = clamp(this.hp / this.maxHp, 0, 1);
    this.barFg.scale.x = Math.max(0.0001, this.barW * frac);
    this.barFg.position.x = -this.barW * (1 - frac) * 0.5;
    const shFrac = clamp(this.shield / this.maxHp, 0, 1);
    this.barShield.scale.x = Math.max(0.0001, this.barW * shFrac);
    this.barShield.position.x = -this.barW * (1 - shFrac) * 0.5;
    this.marker.position.copy(this.position);
    this.marker.position.y += this.height + 1.05 + Math.sin(t * 2.6) * 0.09;
    this.marker.rotation.y = t * 1.4;
    this.markMat.opacity = 0.75 + Math.sin(t * 2.6) * 0.2;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.game.scene.remove(this.model);
    this.game.scene.remove(this.barGroup);
    this.game.scene.remove(this.marker);
    this.model.traverse((o) => {
      // GLB geometry is shared with the preloaded template — never dispose it
      if (o.geometry && !this.usesGlb) o.geometry.dispose();
      if (o.material && o.material !== this.outlineMat) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
    this.outlineMat.dispose();
    this.marker.geometry.dispose();
    this.markMat.dispose();
    for (const s of [this.barBg, this.barFg, this.barShield]) s.material.dispose();
  }
}
