import * as THREE from 'three';
import { MODEL_BUILDERS } from './enemyModels.js';
import { buildGlbInstance } from './enemyAssets.js';
import { clamp, damp } from './utils.js';

// ---------------------------------------------------------------------------
// Enemy: shared body (physics, damage, freeze, knockback, hp bar, death)
// plus per-type AI behaviors. Difficulty scaling comes from the wave system
// via the hpMul/dmgMul options.
// ---------------------------------------------------------------------------

const GRAVITY = 26;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

export const ENEMY_TYPES = {
  rusher:   { hp: 42,  radius: 0.55, height: 1.9, speed: 8.2, flying: false, elite: false, score: 1 },
  sniper:   { hp: 34,  radius: 0.5,  height: 2.3, speed: 5.5, flying: false, elite: false, score: 1 },
  flyer:    { hp: 30,  radius: 0.6,  height: 1.0, speed: 9.5, flying: true,  elite: false, score: 1 },
  blinker:  { hp: 38,  radius: 0.5,  height: 1.9, speed: 6.0, flying: false, elite: false, score: 2 },
  shielder: { hp: 60,  radius: 0.7,  height: 1.7, speed: 3.4, flying: false, elite: false, score: 2 },
  bomber:   { hp: 26,  radius: 0.45, height: 1.0, speed: 10.5, flying: false, elite: false, score: 1 },
  golem:    { hp: 260, radius: 1.3,  height: 3.3, speed: 3.1, flying: false, elite: true,  score: 5 },
  knight:   { hp: 170, radius: 0.6,  height: 2.2, speed: 8.5, flying: false, elite: true,  score: 5 },
  wraith:     { hp: 30,  radius: 0.45, height: 1.7, speed: 10,   flying: true, elite: false, score: 1 },
  swarmling:  { hp: 9,   radius: 0.28, height: 0.45, speed: 13,  flying: true, elite: false, score: 1 },
  sentinel:   { hp: 240, radius: 1.1,  height: 2.4, speed: 10,   flying: true, elite: true,  score: 5 },
};

// codex entries (names match the model builders' codenames)
export const ENEMY_INFO = {
  rusher: {
    name: 'Blade Husk', threat: 'Common',
    blurb: 'A hooded wraith with two floating blades. Sprints straight at you, winds up, and lunges with a slash.',
    tip: 'Watch for the blade raise — that’s the windup. Dash sideways or jump over the lunge.',
  },
  sniper: {
    name: 'Hex Caster', threat: 'Common',
    blurb: 'A tall robed caster that keeps its distance and charges a slow homing hex bolt. Hops away if you get close.',
    tip: 'The orb glows brighter as the shot charges. Close the gap or break line of sight before it fires.',
  },
  flyer: {
    name: 'Sky Stinger', threat: 'Common',
    blurb: 'A winged darter that orbits above you, then dives in strafing runs of three quick bolts.',
    tip: 'It only shoots during dives. Meet it in the air — it’s fragile.',
  },
  blinker: {
    name: 'Void Stalker', threat: 'Toxic',
    blurb: 'A slim figure wreathed in orbiting shards. Circles at range and lobs volleys of venom missiles that arc through the air and chase you down. Each hit leaves poison ticking on you.',
    tip: 'The missiles track hard but turn slowly — cut sideways or dash late and they’ll overshoot. Don’t eat several at once; the poison stacks up fast.',
  },
  shielder: {
    name: 'Aegis Construct', threat: 'Priority target',
    blurb: 'A stocky guardian with a rune ring. Projects a golden aura that makes every nearby enemy IMMUNE to damage.',
    tip: 'Nothing inside the gold glow can be hurt — kill the construct first, always.',
  },
  bomber: {
    name: 'Cinder Imp', threat: 'Common',
    blurb: 'A round ember creature that sprints at you, swells, and detonates. The blast hurts other enemies too.',
    tip: 'Shoot it at range, or bait it into a crowd and let it do your work.',
  },
  golem: {
    name: 'Stone Colossus', threat: 'ELITE',
    blurb: 'A towering elite. Slams with its arms up close and pounds the ground at range, sending out an expanding shockwave.',
    tip: 'The shockwave only hits you on the ground — jump it. Heavy knockback barely moves the golem.',
  },
  knight: {
    name: 'Storm Knight', threat: 'ELITE',
    blurb: 'An armored duelist that fights like a player: gap-closing dashes, two-hit sword combos, aerial bolt volleys — and it dodges sideways when you aim straight at it.',
    tip: 'Don’t stare it down; flick your aim. Punish it right after its combo whiffs.',
  },
  wraith: {
    name: 'Gale Wraith', threat: 'Common',
    blurb: 'A swirling wind spirit that circles at range on a deliberately erratic path, firing bursts of piercing wind-blades. Sometimes yanks you toward it with a gust.',
    tip: 'Its flight path is jittery on purpose — don’t try to lead your shots the way you would a Sky Stinger, just keep it in your crosshair and burn it down.',
  },
  swarmling: {
    name: 'Skyshard Swarmling', threat: 'Swarm',
    blurb: 'Tiny glowing shard-insects that mob you in a loose flock. Individually harmless, but they burst into homing mini-shards when they die.',
    tip: 'Kill them fast and from a bit of range — the death-burst shards are weak but there are a lot of swarmlings.',
  },
  sentinel: {
    name: 'Tempest Sentinel', threat: 'ELITE',
    blurb: 'A hovering four-winged construct. Alternates a tracking 5-bolt volley with a full-commit dash straight through your position.',
    tip: 'The dash is a hard telegraph and total commitment — dodge it and punish the recovery. Don’t stand still during the volley phase.',
  },
};

export class Enemy {
  constructor(game, type, pos, { hpMul = 1, dmgMul = 1 } = {}) {
    this.game = game;
    this.type = type;
    const def = ENEMY_TYPES[type];
    this.def = def;
    this.maxHp = Math.round(def.hp * hpMul);
    this.hp = this.maxHp;
    this.dmgMul = dmgMul;
    this.radius = def.radius;
    this.height = def.height;
    this.flying = def.flying;
    this.elite = def.elite;
    this.speed = def.speed;

    this.position = pos.clone();
    this.vel = new THREE.Vector3();
    this.facing = new THREE.Vector3(0, 0, 1);
    this.alive = true;
    this.readyToRemove = false;
    this.grounded = false;
    this.frozen = 0;
    this.marked = 0;
    this.flashT = 0;
    this.deathT = 0;
    this.slowUntil = 0;
    this.shieldedBy = null;
    this.aggro = false;
    this.s = {};                 // per-AI state
    this.attackCd = 1 + Math.random() * 1.5;

    // model: preloaded GLB if it's ready, procedural builder otherwise
    const built = buildGlbInstance(type, def) ?? MODEL_BUILDERS[type]();
    this.model = built.group;
    this.parts = built.parts ?? {};
    this.materials = built.materials;
    if (built.mixer) {
      this.mixer = built.mixer;
      this.animIdle = built.idle;
      this.animMove = built.move;
      this.inner = built.inner;
      this.glbScale = built.scale;
    }
    // stylized fill: dark parts self-illuminate slightly so enemies stay
    // readable when backlit by the sunset
    for (const m of this.materials) {
      if (m.emissive.getHex() === 0) {
        m.emissive.copy(m.color).multiplyScalar(0.35);
      }
    }
    this.baseEmissive = this.materials.map((m) => ({ e: m.emissive.clone(), i: m.emissiveIntensity }));
    this.model.position.copy(this.position);
    game.scene.add(this.model);

    // hp bar (two flat sprites above the head)
    const barGroup = new THREE.Group();
    const bgMat = new THREE.SpriteMaterial({ color: 0x111318, depthWrite: false, transparent: true, opacity: 0.85 });
    const fgMat = new THREE.SpriteMaterial({ color: this.elite ? 0xffb23a : 0xff5555, depthWrite: false, transparent: true, opacity: 0.95 });
    this.barBg = new THREE.Sprite(bgMat);
    this.barFg = new THREE.Sprite(fgMat);
    const w = this.elite ? 2.2 : 1.1;
    this.barW = w;
    this.barBg.scale.set(w, 0.12, 1);
    this.barFg.scale.set(w, 0.09, 1);
    barGroup.add(this.barBg);
    barGroup.add(this.barFg);
    barGroup.visible = false;
    this.barGroup = barGroup;
    game.scene.add(barGroup);

    // spawn-in flash
    game.effects.burst(pos.clone().add(_v1.set(0, def.height * 0.5, 0)), {
      count: 18, color: 0x9a8cff, speed: 6, size: 0.3, life: 0.4, gravity: 0,
    });
  }

  // ---------- damage ----------
  takeDamage(dmg, { knockback = null, freeze = 0, poison = null, slow = 0, source = 'player' } = {}) {
    if (!this.alive) return;
    // protected by a living shielder: immune
    if (this.shieldedBy && this.shieldedBy.alive && this.shieldedBy !== this) {
      this.game.effects.glow(this.center(_v1), { color: 0xffd76a, size: 1.6, life: 0.2 });
      return;
    }
    if (this.marked > 0) dmg *= 1.35;
    // void poison: damage over time, refreshes rather than stacks
    if (poison) {
      this.poisonT = Math.max(this.poisonT || 0, poison.t);
      this.poisonDps = Math.max(this.poisonDps || 0, poison.dps);
    }
    if (slow > 0) this.slowUntil = Math.max(this.slowUntil, this.game.simTime + slow);
    this.hp -= dmg;
    this.flashT = 0.12;
    this.aggro = true;
    if (this.game.onEnemyDamaged) this.game.onEnemyDamaged(this, dmg);
    // comic impact frame on heavy hits
    if (dmg >= 25 && source === 'player') {
      this.game.effects.impactBurst(this.center(_v1).clone(), { size: 2 + Math.min(2.5, dmg * 0.03) });
      this.game.hitstop(0.045);
    }
    if (knockback) {
      const resist = this.type === 'golem' ? 0.22 : this.type === 'knight' ? 0.55 : 1;
      this.vel.addScaledVector(knockback, resist);
      if (knockback.y > 1.5 && !this.flying) this.grounded = false;
    }
    if (freeze > 0) this.frozen = Math.max(this.frozen, freeze);
    if (this.hp <= 0) this.die(source);
  }

  die(source = 'player') {
    if (!this.alive) return;
    this.alive = false;
    this.deathT = 0;
    this.barGroup.visible = false;
    const c = this.center(_v1).clone();
    this.game.effects.burst(c, {
      count: this.elite ? 46 : 24, color: 0xffffff, color2: 0x888899,
      speed: this.elite ? 12 : 8, size: 0.3, life: 0.5,
    });
    this.game.effects.glow(c, { color: 0xfff2cc, size: this.elite ? 3 : 1.6, life: 0.3, grow: 4 });
    // swarmlings scatter into a few weak homing shards on death, so thinning
    // a flock still carries a little bit of a sting
    if (this.type === 'swarmling') {
      const g = this.game;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(a), 0.15, Math.sin(a));
        g.projectiles.spawn({
          pos: c.clone(), vel: dir.multiplyScalar(9),
          owner: 'enemy', damage: 4 * this.dmgMul, color: 0xffcc55, size: 0.22,
          homing: 0.6, gravity: 0, life: 1.4, knockback: 3,
        });
      }
    }
    if (this.game.onEnemyKilled) this.game.onEnemyKilled(this, source);
    this.game.audio?.play(this.elite ? 'eliteDeath' : 'enemyDeath');
  }

  center(target) {
    return target.copy(this.position).setY(this.position.y + this.height * 0.5);
  }

  // ---------- movement helpers ----------
  moveToward(target, speed, dt, { keepDistance = 0, edgeSafe = true } = {}) {
    _v2.copy(target).sub(this.position);
    _v2.y = 0;
    const dist = _v2.length();
    if (dist < 0.01) return;
    _v2.normalize();
    if (keepDistance && dist < keepDistance) _v2.negate();
    if (this.slowUntil > this.game.simTime - 0.01 && this.slowUntil > 0) speed *= 0.5;
    if (this.frozen > 0) return;
    const step = speed * dt;
    // don't walk off edges voluntarily
    if (edgeSafe && !this.flying && this.grounded) {
      const nx = this.position.x + _v2.x * (step + this.radius + 0.7);
      const nz = this.position.z + _v2.z * (step + this.radius + 0.7);
      const g = this.game.world.groundHeightBelow(nx, nz, this.position.y + 2, this.game.simTime, 3);
      if (g === null) return; // cliff ahead: stop
    }
    this.position.x += _v2.x * step;
    this.position.z += _v2.z * step;
    this.faceToward(target, dt);
  }

  faceToward(target, dt, rate = 10) {
    _v3.copy(target).sub(this.position);
    _v3.y = 0;
    if (_v3.lengthSq() < 0.001) return;
    _v3.normalize();
    this.facing.lerp(_v3, Math.min(1, rate * dt)).normalize();
  }

  canSeePlayer() {
    const g = this.game;
    // smoke: if the player is inside smoke and we're not right next to them, lost
    if (g.playerInSmoke()) {
      return this.position.distanceTo(g.player.position) < 4;
    }
    return true;
  }

  // threat position (decoy overrides the player)
  threat() {
    return this.game.threatTarget();
  }

  // ---------- per-frame ----------
  update(dt, time) {
    const g = this.game;

    // death animation
    if (!this.alive) {
      this.deathT += dt;
      const k = this.deathT / 0.7;
      this.model.scale.setScalar(Math.max(0.01, 1 - k));
      this.model.position.y = this.position.y - k * 0.6;
      this.model.rotation.x += dt * 2;
      if (this.deathT > 0.7) this.readyToRemove = true;
      return;
    }

    if (this.frozen > 0) this.frozen -= dt;
    if (this.marked > 0) this.marked -= dt;
    if (this.flashT > 0) this.flashT -= dt;
    if (this.attackCd > 0) this.attackCd -= dt;

    // ---- void poison tick ----
    if (this.poisonT > 0) {
      this.poisonT -= dt;
      this.poisonTick = (this.poisonTick ?? 0) - dt;
      if (this.poisonTick <= 0) {
        this.poisonTick = 0.5;
        const d = this.poisonDps * 0.5;
        this.hp -= d;
        if (this.game.onEnemyDamaged) this.game.onEnemyDamaged(this, d);
        const c = this.center(_v1).clone();
        c.x += (Math.random() - 0.5) * this.radius;
        this.game.effects.glow(c, { color: 0x7a3fd9, size: 0.8, life: 0.35, grow: 1.2 });
        if (this.hp <= 0) { this.die('player'); return; }
      }
    }

    // ---- physics ----
    if (!this.flying) {
      this.vel.y -= GRAVITY * dt;
      const prevY = this.position.y;
      this.position.addScaledVector(this.vel, dt);
      const ground = g.world.groundHeightBelow(
        this.position.x, this.position.z,
        Math.max(prevY, this.position.y), time,
        this.grounded ? 0.75 : 0.05
      );
      this.grounded = false;
      if (ground !== null && this.position.y <= ground + 0.001 + 0.6 && this.vel.y <= 0.01) {
        this.position.y = ground;
        this.vel.y = 0;
        this.grounded = true;
        // ground friction on knockback slide
        const f = Math.exp(-6 * dt);
        this.vel.x *= f; this.vel.z *= f;
      }
    } else {
      // flyers: damped velocity, stay above terrain
      this.position.addScaledVector(this.vel, dt);
      const f = Math.exp(-2.5 * dt);
      this.vel.multiplyScalar(f);
      const ground = g.world.groundHeightBelow(this.position.x, this.position.z, this.position.y + 50, time, 60);
      if (ground !== null && this.position.y < ground + 1.2) this.position.y = ground + 1.2;
    }

    // fell into the void
    if (this.position.y < -80) {
      this.hp = 0;
      this.die('void');
      this.readyToRemove = true;
      return;
    }

    // don't overlap the player
    _v2.copy(this.position).sub(g.player.position);
    _v2.y = 0;
    {
      const d = _v2.length();
      const minD = this.radius + 0.9;
      if (d < minD && d > 0.001) {
        _v2.normalize().multiplyScalar(minD - d);
        this.position.add(_v2);
      }
    }

    // separation from other enemies
    for (const other of g.enemies) {
      if (other === this || !other.alive) continue;
      _v2.copy(this.position).sub(other.position);
      _v2.y = 0;
      const d = _v2.length();
      const minD = this.radius + other.radius + 0.15;
      if (d < minD && d > 0.001) {
        _v2.normalize().multiplyScalar((minD - d) * 0.5);
        this.position.add(_v2);
      }
    }

    // ---- AI ----
    if (this.frozen <= 0 && g.player.alive) {
      BEHAVIORS[this.type](this, dt, time);
    }

    // ---- visuals ----
    this.model.position.copy(this.position);
    const targetYaw = Math.atan2(this.facing.x, this.facing.z);
    this.model.rotation.y = dampAngle(this.model.rotation.y, targetYaw, 10, dt);
    if (this.mixer) this.updateGlbAnim(dt);
    else ANIMATIONS[this.type]?.(this, dt, time);

    // freeze / flash / mark tinting
    for (let i = 0; i < this.materials.length; i++) {
      const m = this.materials[i];
      const base = this.baseEmissive[i];
      if (this.flashT > 0) {
        m.emissive.setHex(0xffffff);
        m.emissiveIntensity = 1.4;
      } else if (this.frozen > 0) {
        m.emissive.setHex(0x3388ff);
        m.emissiveIntensity = 0.7;
      } else if (this.poisonT > 0) {
        m.emissive.setHex(0x5a2a99);
        m.emissiveIntensity = 0.55 + Math.sin(time * 9) * 0.2;
      } else {
        m.emissive.copy(base.e);
        m.emissiveIntensity = base.i;
      }
    }
    // marked indicator
    if (this.marked > 0 && Math.random() < dt * 12) {
      const p = this.center(_v1).clone();
      p.y += this.height * 0.55 + 0.25;
      g.effects.glow(p, { color: 0xff44aa, size: 0.5, life: 0.25 });
    }
    // shielded aura
    if (this.shieldedBy && this.shieldedBy.alive && this.shieldedBy !== this && Math.random() < dt * 8) {
      g.effects.glow(this.center(_v1).clone(), { color: 0xffd76a, size: this.radius * 3, life: 0.3 });
    }

    // hp bar (guard on this.alive: a behavior can self-kill mid-update, e.g.
    // the bomber's detonate — without this, this line runs *after* that flips
    // alive=false and re-shows the bar since hp(0) < maxHp reads as "damaged")
    const damaged = this.hp < this.maxHp;
    this.barGroup.visible = this.alive && damaged;
    if (damaged) {
      this.barGroup.position.copy(this.position);
      this.barGroup.position.y += this.height + 0.55;
      const frac = clamp(this.hp / this.maxHp, 0, 1);
      this.barFg.scale.x = this.barW * frac;
      this.barFg.position.x = -(this.barW * (1 - frac)) / 2;
    }
  }

  // GLB models: crossfade idle<->move by how fast the enemy actually moved
  // this frame (AI writes position directly, so velocity alone can't tell)
  updateGlbAnim(dt) {
    const s = this.s;
    if (!s._lastPos) s._lastPos = this.position.clone();
    const planar = dt > 0
      ? Math.hypot(this.position.x - s._lastPos.x, this.position.z - s._lastPos.z) / dt
      : 0;
    s._lastPos.copy(this.position);
    const k = clamp(planar / Math.max(1, this.speed * 0.5), 0, 1);
    const w = damp(this.animMove.getEffectiveWeight(), k, 8, dt);
    this.animMove.setEffectiveWeight(w);
    this.animIdle.setEffectiveWeight(1 - w);
    this.animMove.timeScale = 0.6 + k * 0.8;
    // generic telegraphs the baked clips don't cover: bomber swell + a
    // readable puff-up during any attack windup
    let squash = 1;
    if (s.fuse !== undefined) squash = 1 + (0.65 - s.fuse) * 0.9;
    else if (s.windup > 0 || s.charge > 0 || s.slamT > 0 || s.comboT > 0 || s.volley > 0) squash = 1.12;
    this.inner.scale.setScalar(damp(this.inner.scale.x, this.glbScale * squash, 14, dt));
    this.mixer.update(this.frozen > 0 ? 0 : dt);
  }

  // enemy ranged shot
  shoot(from, dir, { speed = 26, damage = 13, color = 0xe055ff, size = 0.4, homing = 0, poison = null, life = 5 } = {}) {
    this.game.projectiles.spawn({
      pos: from, vel: dir.clone().multiplyScalar(speed),
      owner: 'enemy', damage: damage * this.dmgMul, color, size,
      homing, gravity: 0, life, knockback: 7, poison,
    });
    this.game.audio?.play('enemyShot');
  }

  // enemy melee swing at the player
  meleeStrike(range, damage, kb = 8) {
    const g = this.game;
    _v1.copy(g.player.position).setY(g.player.position.y + 0.9);
    const d = this.center(_v2).distanceTo(_v1);
    if (d < range + 0.6) {
      if (g.player.takeDamage(damage * this.dmgMul, this.position)) {
        const push = _v1.copy(g.player.position).sub(this.position).setY(0).normalize().multiplyScalar(kb);
        push.y = kb * 0.55;
        g.player.applyKnockback(push);
        g.audio?.play('playerHurt');
      }
    }
  }

  dispose() {
    this.game.scene.remove(this.model);
    this.game.scene.remove(this.barGroup);
    this.model.traverse((o) => {
      // GLB geometry is shared with the preloaded template — never dispose it
      if (o.geometry && !this.mixer) o.geometry.dispose();
      if (o.material) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
    this.barBg.material.dispose();
    this.barFg.material.dispose();
  }
}

function dampAngle(a, b, lambda, dt) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * (1 - Math.exp(-lambda * dt));
}

// ===========================================================================
// AI behaviors
// ===========================================================================

const BEHAVIORS = {
  // -- rusher: chase, windup, lunge slash --
  rusher(e, dt) {
    const g = e.game;
    const target = e.threat();
    const dist = e.position.distanceTo(target);
    const s = e.s;
    if (s.windup > 0) {
      s.windup -= dt;
      e.faceToward(target, dt, 14);
      if (s.windup <= 0) {
        // lunge!
        _v1.copy(target).sub(e.position).setY(0).normalize();
        e.vel.addScaledVector(_v1, 9);
        e.meleeStrike(3.0, 12);
        e.attackCd = 1.3;
        g.effects.glow(e.center(_v2).clone(), { color: 0xff7a2a, size: 1.4, life: 0.18 });
        g.audio?.play('swipe');
      }
      return;
    }
    if (!e.canSeePlayer()) {
      // lost the player: wander toward last known area slowly
      e.moveToward(target, e.speed * 0.25, dt);
      return;
    }
    if (dist < 3.0 && e.attackCd <= 0) {
      s.windup = 0.38;
      g.audio?.play('windup');
    } else {
      e.moveToward(target, e.speed, dt, { keepDistance: 2.0 });
    }
  },

  // -- sniper: keep range, charge, fire --
  sniper(e, dt) {
    const g = e.game;
    const target = e.threat();
    const dist = e.position.distanceTo(target);
    const s = e.s;
    if (s.charge > 0) {
      s.charge -= dt;
      e.faceToward(target, dt, 8);
      if (s.charge <= 0) {
        const from = e.parts.orb
          ? e.parts.orb.getWorldPosition(new THREE.Vector3())
          : e.center(new THREE.Vector3());
        const to = _v1.copy(g.player.position).setY(g.player.position.y + 1.0);
        // lead the player slightly
        to.addScaledVector(g.player.vel, dist / 30);
        const dir = to.sub(from).normalize();
        e.shoot(from, dir, { speed: 28, damage: 13, color: 0xe055ff, size: 0.45, homing: 0.5 });
        e.attackCd = 2.4;
      }
      return;
    }
    if (!e.canSeePlayer()) { e.moveToward(target, e.speed * 0.3, dt); return; }
    if (dist < 9) {
      // too close: hop back
      if (e.grounded && e.attackCd <= 0.8) {
        _v1.copy(e.position).sub(target).setY(0).normalize();
        e.vel.addScaledVector(_v1, 8);
        e.vel.y = 7;
        e.grounded = false;
      }
      e.moveToward(target, e.speed, dt, { keepDistance: 14 });
    } else if (dist > 34) {
      e.moveToward(target, e.speed, dt);
    } else {
      e.faceToward(target, dt);
      if (e.attackCd <= 0) {
        s.charge = 1.0;
        g.audio?.play('chargeStart');
      }
    }
  },

  // -- flyer: orbit above, periodic strafing dives with bolt bursts --
  flyer(e, dt, time) {
    const g = e.game;
    const target = e.threat();
    const s = e.s;
    s.orbitA = (s.orbitA ?? Math.random() * Math.PI * 2) + dt * 0.9;
    if (s.dive > 0) {
      s.dive -= dt;
      // strafe toward a point near the player
      _v1.copy(g.player.position); _v1.y += 2.5;
      _v2.copy(_v1).sub(e.position);
      const d = _v2.length();
      _v2.normalize();
      e.vel.addScaledVector(_v2, 26 * dt);
      e.faceToward(g.player.position, dt, 12);
      s.burstT -= dt;
      if (d < 16 && s.burstT <= 0 && s.shots > 0) {
        s.shots--;
        s.burstT = 0.16;
        const from = e.center(new THREE.Vector3());
        const dir = _v1.copy(g.player.position).setY(g.player.position.y + 1).sub(from).normalize();
        e.shoot(from, dir, { speed: 26, damage: 5, color: 0x4ae0ff, size: 0.3 });
      }
      if (s.dive <= 0) e.attackCd = 2.8 + Math.random();
      return;
    }
    // hover-orbit above the player
    const R = 11;
    _v1.set(
      target.x + Math.cos(s.orbitA) * R,
      g.player.position.y + 6 + Math.sin(time * 1.3 + s.orbitA) * 1.5,
      target.z + Math.sin(s.orbitA) * R
    );
    _v2.copy(_v1).sub(e.position);
    e.vel.addScaledVector(_v2.normalize(), 14 * dt);
    e.faceToward(g.player.position, dt, 6);
    if (e.attackCd <= 0 && e.canSeePlayer()) {
      s.dive = 1.6;
      s.shots = 3;
      s.burstT = 0.3;
    }
  },

  // -- blinker: "Void Stalker" — strafes at range, volleys poisonous homing missiles --
  blinker(e, dt) {
    const g = e.game;
    const target = e.threat();
    const dist = e.position.distanceTo(g.player.position);
    const s = e.s;
    if (s.volley > 0) {
      s.volley -= dt;
      e.faceToward(g.player.position, dt, 12);
      s.shotT -= dt;
      if (s.shotT <= 0 && s.shots > 0) {
        s.shots--;
        s.shotT = 0.28;
        const from = e.center(new THREE.Vector3());
        from.y += 0.3;
        // lob outward with spread; the strong homing curves them back in
        const dir = _v1.copy(g.player.position).setY(g.player.position.y + 1).sub(from).normalize();
        dir.x += (Math.random() - 0.5) * 0.8;
        dir.y += 0.35 + Math.random() * 0.3;
        dir.z += (Math.random() - 0.5) * 0.8;
        dir.normalize();
        e.shoot(from, dir, {
          speed: 14, damage: 6, color: 0x8fff4a, size: 0.38, homing: 2.4, life: 4,
          poison: { t: 3, dps: 3 * e.dmgMul },
        });
        g.effects.glow(from.clone(), { color: 0x8fff4a, size: 1.1, life: 0.2 });
      }
      if (s.volley <= 0) e.attackCd = 3.4 + Math.random() * 1.2;
      return;
    }
    if (!e.canSeePlayer()) { e.moveToward(target, e.speed * 0.4, dt); return; }
    if (e.attackCd <= 0 && dist < 30) {
      s.volley = 1.0;
      s.shots = 3;
      s.shotT = 0.15;
      g.audio?.play('chargeStart');
      return;
    }
    // strafe-orbit at missile range so it never stands still
    const orbitDir = (s.orbitSign ?? (s.orbitSign = Math.random() < 0.5 ? 1 : -1));
    _v1.copy(g.player.position).sub(e.position).setY(0).normalize();
    _v2.crossVectors(_v1, new THREE.Vector3(0, 1, 0)).multiplyScalar(orbitDir);
    const desired = _v3.copy(g.player.position).addScaledVector(_v1, -12).addScaledVector(_v2, 5);
    e.moveToward(desired, e.speed, dt);
    e.faceToward(g.player.position, dt);
  },

  // -- shielder: walk toward the fight, shield nearby allies (see Game pre-pass) --
  shielder(e, dt) {
    const target = e.threat();
    e.moveToward(target, e.speed, dt, { keepDistance: 7 });
    // periodic pulse visual so the player notices the aura source
    e.s.pulseT = (e.s.pulseT ?? 0) - dt;
    if (e.s.pulseT <= 0) {
      e.s.pulseT = 2.6;
      e.game.effects.ring(e.center(new THREE.Vector3()), {
        color: 0xffd76a, endRadius: 9, life: 0.7, opacity: 0.4, thickness: 0.2,
      });
    }
  },

  // -- bomber: sprint at the player and detonate --
  bomber(e, dt) {
    const g = e.game;
    const target = e.threat();
    const dist = e.position.distanceTo(g.player.position);
    const s = e.s;
    if (s.fuse !== undefined) {
      s.fuse -= dt;
      if (s.fuse <= 0) {
        // detonate
        const c = e.center(new THREE.Vector3());
        g.effects.burst(c, { count: 40, color: 0xff6622, color2: 0xffcc44, speed: 15, size: 0.4, life: 0.55 });
        g.effects.ring(c, { color: 0xff7733, endRadius: 4.8, life: 0.4 });
        g.effects.glow(c, { color: 0xffaa55, size: 4, life: 0.3, grow: 6 });
        _v1.copy(g.player.position).setY(g.player.position.y + 0.9);
        if (_v1.distanceTo(c) < 4.8) {
          g.player.takeDamage(26 * e.dmgMul, c);
          g.player.applyKnockback(_v1.sub(c).normalize().multiplyScalar(12).setY(7));
        }
        // hurts other enemies too
        for (const other of g.enemies) {
          if (other === e || !other.alive) continue;
          if (other.center(_v2).distanceTo(c) < 4.8) {
            other.takeDamage(20, { knockback: _v2.sub(c).normalize().multiplyScalar(8).setY(5), source: 'bomber' });
          }
        }
        g.audio?.play('explosion');
        g.player.shake(Math.max(0, 0.5 - _v1.distanceTo(c) * 0.04));
        e.hp = 0;
        e.alive = false;       // no second explosion via die()
        e.deathT = 0.69;       // skip most of the shrink anim
        if (g.onEnemyKilled) g.onEnemyKilled(e, 'self');
        return;
      }
      return;
    }
    if (dist < 3.2) {
      s.fuse = 0.65;
      g.audio?.play('fuse');
    } else {
      e.moveToward(g.player.position, e.speed, dt);
    }
  },

  // -- golem elite: arm slams close, ground shockwaves at range --
  golem(e, dt) {
    const g = e.game;
    const target = e.threat();
    const dist = e.position.distanceTo(g.player.position);
    const s = e.s;
    // active shockwave ring expands and hits grounded players
    if (s.wave) {
      s.wave.r += s.wave.speed * dt;
      const ringPos = _v1.copy(s.wave.origin);
      if (Math.random() < dt * 40) {
        const a = Math.random() * Math.PI * 2;
        const p = new THREE.Vector3(ringPos.x + Math.cos(a) * s.wave.r, ringPos.y + 0.2, ringPos.z + Math.sin(a) * s.wave.r);
        g.effects.burst(p, { count: 3, color: 0xbfa78a, speed: 3, size: 0.25, life: 0.3, additive: false });
      }
      const playerDist = Math.hypot(g.player.position.x - ringPos.x, g.player.position.z - ringPos.z);
      if (!s.wave.hit && g.player.grounded && Math.abs(playerDist - s.wave.r) < 1.4
          && Math.abs(g.player.position.y - ringPos.y) < 2.5) {
        s.wave.hit = true;
        g.player.takeDamage(18 * e.dmgMul, ringPos);
        g.player.applyKnockback(new THREE.Vector3(0, 9, 0));
        g.audio?.play('playerHurt');
      }
      if (s.wave.r > s.wave.maxR) s.wave = null;
    }
    if (s.slamT > 0) {
      s.slamT -= dt;
      e.faceToward(g.player.position, dt, 6);
      if (s.slamT <= 0) {
        if (s.slamKind === 'melee') {
          e.meleeStrike(4.6, 24, 13);
          g.effects.burst(e.position.clone().addScaledVector(e.facing, 2), {
            count: 24, color: 0xbfa78a, color2: 0x7a6a55, speed: 8, size: 0.35, life: 0.5, additive: false,
          });
        } else {
          // ground pound: launch the shockwave
          const origin = e.position.clone();
          s.wave = { origin, r: 1.5, speed: 13, maxR: 15, hit: false };
          g.effects.ring(origin.clone().add(_v2.set(0, 0.3, 0)), { color: 0xd9b45e, endRadius: 15, life: 1.1, opacity: 0.6, thickness: 0.5 });
          g.player.shake(0.3);
        }
        g.audio?.play('slam');
        e.attackCd = s.slamKind === 'melee' ? 1.8 : 3.5;
      }
      return;
    }
    if (e.attackCd <= 0 && e.canSeePlayer()) {
      if (dist < 5.5) { s.slamT = 0.6; s.slamKind = 'melee'; g.audio?.play('windup'); }
      else if (dist < 16 && g.player.grounded) { s.slamT = 0.75; s.slamKind = 'pound'; g.audio?.play('windup'); }
    }
    e.moveToward(target, e.speed, dt, { keepDistance: 3.5 });
  },

  // -- storm knight elite: duelist with dashes, combos, aerial volleys, dodges --
  knight(e, dt, time) {
    const g = e.game;
    const player = g.player;
    const target = e.threat();
    const dist = e.position.distanceTo(player.position);
    const s = e.s;
    s.dodgeCd = Math.max(0, (s.dodgeCd ?? 0) - dt);

    // dodge sideways when the player aims right at us
    if (s.dodgeCd <= 0 && dist < 28 && e.grounded) {
      const aim = _v1.set(0, 0, 0);
      g.camera.getWorldDirection(aim);
      _v2.copy(e.position).sub(player.eyePosition).normalize();
      if (aim.dot(_v2) > 0.996) {
        const side = Math.random() < 0.5 ? 1 : -1;
        _v3.crossVectors(_v2, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(14 * side);
        _v3.y = 5;
        e.vel.add(_v3);
        e.grounded = false;
        s.dodgeCd = 2.2;
        g.effects.dashStreaks(g.camera);
        g.effects.burst(e.center(new THREE.Vector3()), { count: 10, color: 0x66eaff, speed: 6, size: 0.22, life: 0.3 });
        g.audio?.play('dash');
      }
    }

    // aerial volley: leap and fire while air-stalling
    if (s.volley > 0) {
      s.volley -= dt;
      e.vel.y *= 0.86;    // air-stall mimic
      e.faceToward(player.position, dt, 12);
      s.volleyShot -= dt;
      if (s.volleyShot <= 0 && s.volleyN > 0) {
        s.volleyN--;
        s.volleyShot = 0.22;
        const from = e.center(new THREE.Vector3()); from.y += 0.4;
        const dir = _v1.copy(player.position).setY(player.position.y + 1).sub(from).normalize();
        e.shoot(from, dir, { speed: 32, damage: 8, color: 0x66eaff, size: 0.35 });
      }
      return;
    }

    // melee combo (lunges forward while swinging)
    if (s.comboT > 0) {
      s.comboT -= dt;
      e.faceToward(player.position, dt, 14);
      e.moveToward(player.position, e.speed * 0.6, dt, { keepDistance: 1.6 });
      if (s.comboT <= 0) {
        e.meleeStrike(3.8, s.comboHit === 0 ? 15 : 20, 9);
        g.effects.glow(e.position.clone().addScaledVector(e.facing, 1.4).add(_v2.set(0, 1.4, 0)), {
          color: 0x88eeff, size: 1.6, life: 0.15,
        });
        g.audio?.play('swipe');
        s.comboHit++;
        if (s.comboHit < 2) s.comboT = 0.4;
        else e.attackCd = 2.2;
      }
      return;
    }

    if (e.attackCd <= 0 && e.canSeePlayer()) {
      if (!player.grounded && dist < 20 && e.grounded && Math.random() < 0.4) {
        // leap toward the airborne player and volley
        _v1.copy(player.position).sub(e.position);
        e.vel.x += _v1.x * 0.35;
        e.vel.z += _v1.z * 0.35;
        e.vel.y = 13;
        e.grounded = false;
        s.volley = 1.1;
        s.volleyN = 3;
        s.volleyShot = 0.35;
        g.audio?.play('jump');
        return;
      }
      if (dist > 7 && dist < 26 && e.grounded) {
        // gap-close dash
        _v1.copy(player.position).sub(e.position).setY(0).normalize();
        e.vel.addScaledVector(_v1, 22);
        g.effects.burst(e.center(new THREE.Vector3()), { count: 12, color: 0x66eaff, speed: 5, size: 0.25, life: 0.3 });
        g.audio?.play('dash');
        e.attackCd = 0.5;
        return;
      }
      if (dist < 3.6) {
        s.comboT = 0.35;
        s.comboHit = 0;
        g.audio?.play('windup');
        return;
      }
    }
    // ready to strike and already near: walk straight in for the combo
    if (e.attackCd <= 0 && dist < 8.5) {
      e.moveToward(player.position, e.speed, dt, { keepDistance: 2.2 });
      e.faceToward(player.position, dt);
      return;
    }
    // otherwise strafe-orbit at mid range
    const orbitDir = (s.orbitSign ?? (s.orbitSign = Math.random() < 0.5 ? 1 : -1));
    _v1.copy(player.position).sub(e.position).setY(0).normalize();
    _v2.crossVectors(_v1, new THREE.Vector3(0, 1, 0)).multiplyScalar(orbitDir);
    const desired = _v3.copy(player.position).addScaledVector(_v1, -8).addScaledVector(_v2, 4);
    e.moveToward(desired, e.speed * 0.8, dt);
    e.faceToward(player.position, dt);
  },

  // -- wraith: erratic mid-range orbit, wind-blade bursts, occasional gust pull --
  wraith(e, dt, time) {
    const g = e.game;
    const target = e.threat();
    const s = e.s;
    s.wanderA = (s.wanderA ?? Math.random() * Math.PI * 2) + dt * (0.7 + Math.sin(time * 0.6 + e.position.x) * 0.9);
    s.wanderR = (s.wanderR ?? 12) + Math.sin(time * 1.7 + e.position.z) * dt * 6;
    s.wanderR = clamp(s.wanderR, 8, 16);
    if (s.burst > 0) {
      s.burst -= dt;
      e.faceToward(g.player.position, dt, 10);
      s.shotT -= dt;
      if (s.shotT <= 0 && s.shots > 0) {
        s.shots--;
        s.shotT = 0.14;
        const from = e.center(new THREE.Vector3());
        const dir = _v1.copy(g.player.position).setY(g.player.position.y + 1).sub(from).normalize();
        e.shoot(from, dir, { speed: 27, damage: 7, color: 0x8fd6ff, size: 0.32 });
      }
      return;
    }
    // erratic hover: jittery radius + speed on top of the base orbit, unlike
    // the flyer's smooth predictable circling
    _v1.set(
      target.x + Math.cos(s.wanderA) * s.wanderR,
      g.player.position.y + 3.5 + Math.sin(time * 1.1 + s.wanderA * 1.3) * 2.2,
      target.z + Math.sin(s.wanderA) * s.wanderR
    );
    _v2.copy(_v1).sub(e.position);
    e.vel.addScaledVector(_v2.normalize(), 12 * dt);
    e.faceToward(g.player.position, dt, 5);
    if (e.attackCd <= 0 && e.canSeePlayer()) {
      if (Math.random() < 0.3) {
        // gust pull: tug the player a step toward the wraith
        const pull = _v1.copy(e.position).sub(g.player.position).setY(0).normalize().multiplyScalar(6);
        pull.y = 2;
        g.player.applyKnockback(pull);
        g.effects.ring(e.center(new THREE.Vector3()), { color: 0x8fd6ff, endRadius: 3, life: 0.3, opacity: 0.5 });
        g.audio?.play('whoosh');
      }
      s.burst = 0.5;
      s.shots = 2;
      s.shotT = 0;
      e.attackCd = 2.2 + Math.random();
    }
  },

  // -- swarmling: rush the player in a loose flock, weak contact bites --
  swarmling(e, dt) {
    const g = e.game;
    const target = e.threat();
    const dist = e.position.distanceTo(g.player.position);
    if (dist < 1.9 && e.attackCd <= 0) {
      e.meleeStrike(1.7, 5, 3);
      e.attackCd = 0.85;
    } else {
      e.moveToward(target, e.speed, dt, { keepDistance: 1.3 });
    }
  },

  // -- sentinel elite: alternates a 5-bolt tracking fan with a dash-through --
  sentinel(e, dt, time) {
    const g = e.game;
    const player = g.player;
    const target = e.threat();
    const dist = e.position.distanceTo(player.position);
    const s = e.s;
    if (s.dash) {
      s.dash.t -= dt;
      e.vel.copy(s.dash.dir).multiplyScalar(38);
      if (Math.random() < dt * 30) {
        g.effects.glow(e.center(new THREE.Vector3()), { color: 0x44ddff, size: 1.1, life: 0.25 });
      }
      if (!s.dash.hit) {
        _v1.copy(player.position).setY(player.position.y + 0.9);
        if (e.center(_v2).distanceTo(_v1) < e.radius + 1.1) {
          s.dash.hit = true;
          if (player.takeDamage(24 * e.dmgMul, e.position)) {
            player.applyKnockback(_v1.sub(e.position).setY(0).normalize().multiplyScalar(14).setY(8));
            g.audio?.play('playerHurt');
          }
        }
      }
      if (s.dash.t <= 0) {
        s.dash = null;
        e.attackCd = 3.2;
        g.effects.burst(e.center(new THREE.Vector3()), { count: 20, color: 0x66eaff, speed: 9, size: 0.28, life: 0.4 });
      }
      return;
    }
    if (s.volley > 0) {
      s.volley -= dt;
      e.faceToward(player.position, dt, 8);
      s.volleyT -= dt;
      if (s.volleyT <= 0 && s.volleyN > 0) {
        s.volleyN--;
        s.volleyT = 0.11;
        const from = e.center(new THREE.Vector3());
        const base = _v1.copy(player.position).setY(player.position.y + 1).sub(from).normalize();
        const spread = (s.volleyN - 2) * 0.16; // fan: -2..2 slots around center
        const dir = base.clone();
        dir.x += spread; dir.normalize();
        e.shoot(from, dir, { speed: 30, damage: 9, color: 0x66eaff, size: 0.35 });
      }
      if (s.volley <= 0) e.attackCd = 3.0;
      return;
    }
    if (e.attackCd <= 0 && e.canSeePlayer()) {
      if (dist > 10 && dist < 34 && Math.random() < 0.5) {
        s.dash = { t: Math.min(dist, 30) / 38 + 0.1, dir: _v1.copy(player.position).sub(e.position).normalize().clone(), hit: false };
        g.audio?.play('dash');
      } else {
        s.volley = 0.66;
        s.volleyN = 5;
        s.volleyT = 0;
        g.audio?.play('chargeStart');
      }
      return;
    }
    // hover at mid-range, orbiting slowly
    const R = 15;
    const orbitDir = (s.orbitSign ?? (s.orbitSign = Math.random() < 0.5 ? 1 : -1));
    s.orbitA = (s.orbitA ?? Math.random() * Math.PI * 2) + dt * 0.35 * orbitDir;
    _v1.set(
      target.x + Math.cos(s.orbitA) * R,
      player.position.y + 5 + Math.sin(time * 0.8) * 1.5,
      target.z + Math.sin(s.orbitA) * R
    );
    _v2.copy(_v1).sub(e.position);
    e.vel.addScaledVector(_v2.normalize(), 10 * dt);
    e.faceToward(player.position, dt, 4);
  },
};

// ===========================================================================
// per-type idle/attack animations (part wiggling)
// ===========================================================================

const ANIMATIONS = {
  rusher(e, dt, time) {
    const s = e.s;
    const wind = s.windup > 0 ? 1 : 0;
    const raise = wind ? -1.9 : Math.sin(time * 6 + e.position.x) * 0.15;
    e.parts.bladeL.rotation.x = damp(e.parts.bladeL.rotation.x, raise * 0.5, 14, dt);
    e.parts.bladeR.rotation.x = damp(e.parts.bladeR.rotation.x, raise * 0.5, 14, dt);
    e.model.position.y += Math.sin(time * 4 + e.position.z) * 0.04;
  },
  sniper(e, dt, time) {
    const s = e.s;
    const charging = s.charge > 0;
    const k = charging ? 1 + (1 - s.charge) * 1.2 : 1 + Math.sin(time * 2.5) * 0.1;
    e.parts.orb.scale.setScalar(k);
    e.parts.orb.position.y = 1.5 + Math.sin(time * 2) * 0.08;
    if (charging && Math.random() < dt * 20) {
      e.game.effects.glow(e.parts.orb.getWorldPosition(new THREE.Vector3()), {
        color: 0xe055ff, size: 0.6 + (1 - s.charge), life: 0.1,
      });
    }
  },
  flyer(e, dt, time) {
    const flap = Math.sin(time * 14 + e.position.x * 3) * 0.55;
    e.parts.wingL.rotation.z = flap;
    e.parts.wingR.rotation.z = -flap;
    e.model.rotation.z = clamp(-e.vel.x * 0.02, -0.4, 0.4);
  },
  blinker(e, dt, time) {
    e.parts.shards.rotation.y += dt * 2.5;
    e.parts.shards.position.y = Math.sin(time * 3) * 0.1;
    const w = e.s.windup > 0 ? 1.8 : 1;
    e.parts.eye.scale.set(1.4 * w, w, 1);
  },
  shielder(e, dt, time) {
    e.parts.ring.rotation.y += dt * 1.2;
    e.parts.core.rotation.y += dt * 3;
    e.parts.core.scale.setScalar(1 + Math.sin(time * 4) * 0.12);
  },
  bomber(e, dt, time) {
    const s = e.s;
    if (s.fuse !== undefined) {
      const k = 1 + (0.65 - s.fuse) * 0.9;
      e.parts.body.scale.setScalar(k);
      e.parts.bodyMat.emissiveIntensity = 0.7 + Math.sin(time * 40) * 0.6 + (0.65 - s.fuse) * 2;
    } else {
      e.parts.body.rotation.y += dt * 1.5;
      e.parts.bodyMat.emissiveIntensity = 0.6 + Math.sin(time * 6) * 0.25;
    }
    e.parts.spark.scale.setScalar(1 + Math.sin(time * 18) * 0.4);
  },
  golem(e, dt, time) {
    const s = e.s;
    if (s.slamT > 0) {
      const up = s.slamKind === 'pound' ? -2.4 : -1.8;
      e.parts.armR.rotation.x = damp(e.parts.armR.rotation.x, up, 8, dt);
      if (s.slamKind === 'pound') e.parts.armL.rotation.x = damp(e.parts.armL.rotation.x, up, 8, dt);
    } else {
      e.parts.armR.rotation.x = damp(e.parts.armR.rotation.x, Math.sin(time * 1.5) * 0.1, 6, dt);
      e.parts.armL.rotation.x = damp(e.parts.armL.rotation.x, Math.sin(time * 1.5 + 1) * 0.1, 6, dt);
    }
    e.parts.core.scale.setScalar(1 + Math.sin(time * 3) * 0.15);
  },
  knight(e, dt, time) {
    const s = e.s;
    const attacking = s.comboT > 0 || s.volley > 0;
    const target = attacking ? -2.2 : -0.5 + Math.sin(time * 2) * 0.1;
    e.parts.armR.rotation.z = damp(e.parts.armR.rotation.z, target, attacking ? 18 : 6, dt);
    e.parts.cape.rotation.x = 0.22 + Math.sin(time * 2.2) * 0.08 + Math.hypot(e.vel.x, e.vel.z) * 0.015;
  },
  wraith(e, dt, time) {
    e.parts.ribbons.rotation.y += dt * (e.s.burst > 0 ? 5 : 2);
    e.parts.ribbons.children.forEach((r, i) => {
      r.rotation.x = 0.3 + Math.sin(time * 5 + i * 1.7) * 0.35;
    });
    e.parts.core.scale.setScalar(1 + Math.sin(time * 6) * 0.15);
    e.model.rotation.z = clamp(-e.vel.x * 0.015, -0.3, 0.3);
  },
  swarmling(e, dt, time) {
    const flap = Math.sin(time * 26 + e.position.x * 5) * 0.9;
    e.parts.wingL.rotation.z = flap;
    e.parts.wingR.rotation.z = -flap;
    e.parts.core.rotation.y += dt * 6;
  },
  sentinel(e, dt, time) {
    const s = e.s;
    const spread = s.dash ? 1.6 : s.volley > 0 ? 1.3 : 1 + Math.sin(time * 1.4) * 0.08;
    for (const wing of e.parts.wings) wing.scale.z = spread;
    e.parts.core.scale.setScalar(1 + Math.sin(time * 3.5) * 0.14);
  },
};
