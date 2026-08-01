import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Overtime: after 2:00 of fighting, every competitive map turns hostile. The
// director keys off world.hazardClock (unscaled, seed-synced, reset per
// round), so both online clients hit OVERTIME on the same frame with zero
// network traffic. All event damage uses the local-damage model (each client
// hurts its own player), same as the Maw and the geysers.
// ---------------------------------------------------------------------------

export const OT_AT = 124;   // ~3.6s pre-round countdown + 2:00 of fighting
const _v = new THREE.Vector3();
const _moodTint = new THREE.Color(0x66201a);   // the overtime crimson

export class Overtime {
  constructor(world, game) {
    this.world = world;
    this.game = game;
    this.started = false;
    this.log = [];   // [clockRounded, label] seeded-schedule entries — determinism tests compare these
  }

  get enabled() {
    if (this.debugForce) return true;   // debug sandbox: overtime in solo
    const m = this.game?.mode;
    return m === 'duel' || m === 'ffa' || m === 'botduel';
  }

  get remaining() {
    return this.enabled && !this.started
      ? Math.max(0, OT_AT - this.world.hazardClock) : 0;
  }

  // seconds since overtime began
  get t() { return this.started ? this.world.hazardClock - OT_AT : 0; }

  update(dt) {
    if (!this.enabled) return;
    if (!this.started) {
      if (this.world.hazardClock >= OT_AT) {
        this.started = true;
        const g = this.game;
        g.hud?.announce('OVERTIME', '');
        g.hud?.flash('rgba(255, 64, 40, 0.22)', 0.6);
        g.player?.shake(0.7);
        g.audio?.play('explosion');
        this.log.push([Math.round(this.world.hazardClock * 100) / 100, 'OT']);
        this.begin();
      }
      return;
    }
    // the sky turns: darker, redder, moodier — every map, unmistakable
    this._applyMood(Math.min(1, this.t / 3));
    this.tick(dt);
  }

  _applyMood(k) {
    const w = this.world;
    if (!w.skyMat || k === this._moodK) return;
    this._moodK = k;
    const dim = 1 - 0.5 * k;
    w.skyMat.uniforms.zenith.value.copy(w.skyBase.zenith).multiplyScalar(dim).lerp(_moodTint, 0.22 * k);
    w.skyMat.uniforms.mid.value.copy(w.skyBase.mid).multiplyScalar(dim).lerp(_moodTint, 0.3 * k);
    w.skyMat.uniforms.horizon.value.copy(w.skyBase.horizon).multiplyScalar(1 - 0.35 * k).lerp(_moodTint, 0.35 * k);
    w.skyMat.uniforms.sunColor.value.copy(w.skyBase.sunColor).lerp(_moodTint, 0.3 * k);
    if (w.scene.fog) w.scene.fog.color.copy(w.fogBase).multiplyScalar(1 - 0.35 * k).lerp(_moodTint, 0.3 * k);
    w.sun.intensity = w.sunBaseIntensity * (1 - 0.4 * k);
    if (w.hemiLight) w.hemiLight.intensity = w.hemiBase * (1 - 0.3 * k);
  }

  // subclasses
  begin() {}
  tick(dt) {}
}

// ---------------------------------------------------------------------------
// StrikePool: telegraphed blasts — warning ring, then a damaging shockwave.
// Local-damage model: each client runs its own strikes on its own targets.
// opts.normal orients the ring (and the knockback plane) for strikes on
// tilted faces like the Canopy's underside.
// ---------------------------------------------------------------------------
export class StrikePool {
  constructor(world, game) {
    this.world = world;
    this.game = game;
    this.list = [];
  }

  // target: Vector3 (copied). opts: {r, warnT, dmg, kb, color, normal, victims}
  spawn(target, opts = {}) {
    const o = { r: 6, warnT: 1.3, dmg: 26, kb: 16, color: 0xff5a30, normal: null, ...opts };
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(o.r * 0.82, o.r, 28),
      new THREE.MeshBasicMaterial({
        color: o.color, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    if (o.normal) {
      ring.lookAt(_v.copy(o.normal));            // ring plane ⟂ face normal
      ring.position.copy(target).addScaledVector(o.normal, 0.3);
    } else {
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(target);
      ring.position.y += 0.25;
    }
    this.world.hazardFx.add(ring);
    this.list.push({ pos: target.clone(), t: o.warnT, o, ring });
  }

  update(dt) {
    const g = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.t -= dt;
      s.ring.material.opacity = 0.3 + 0.4 * Math.abs(Math.sin(s.t * 14));
      s.ring.scale.setScalar(1 + (1 - Math.max(0, s.t) / s.o.warnT) * 0.12);
      if (s.t > 0) continue;
      // blast
      this.world.hazardFx.remove(s.ring);
      s.ring.geometry.dispose();
      s.ring.material.dispose();
      this.list.splice(i, 1);
      g.effects.impactBurst(_v.copy(s.pos).setY(s.pos.y + 1).clone(), { color: s.o.color, size: 3.4 });
      g.effects.ring(s.pos.clone(), { color: s.o.color, endRadius: s.o.r + 2, life: 0.4, thickness: 0.5 });
      g.audio?.play('explosion');
      const victims = s.o.victims || this._defaultVictims();
      for (const v of victims) {
        if (!v || !v.alive) continue;
        const d = _v.copy(v.position).distanceTo(s.pos);
        if (d > s.o.r + 1.5) continue;
        const kb = _v.copy(v.position).sub(s.pos);
        if (s.o.normal) {
          // knock along the face plane + a pop off the face
          const n = s.o.normal;
          kb.addScaledVector(n, -kb.dot(n));
          if (kb.lengthSq() < 0.01) kb.set(1, 0, 0);
          kb.normalize().multiplyScalar(s.o.kb).addScaledVector(n, s.o.kb * 0.4);
        } else {
          kb.setY(0);
          if (kb.lengthSq() < 0.01) kb.set(1, 0, 0);
          kb.normalize().multiplyScalar(s.o.kb).setY(s.o.kb * 0.7);
        }
        if (v === g.player) {
          v.takeDamage(s.o.dmg, s.pos, {});
          v.applyKnockback(kb.clone());
          g.player.shake(0.5);
        } else {
          v.takeDamage(s.o.dmg, { knockback: kb.clone(), source: 'hazard' });
        }
      }
    }
  }

  // player always; plus the bot's body in a bot duel (the map fights both sides)
  _defaultVictims() {
    const out = [this.game.player];
    if (this.game.mode === 'botduel') {
      for (const e of this.game.enemies) if (e.type === 'duelist') out.push(e);
    }
    return out;
  }
}
