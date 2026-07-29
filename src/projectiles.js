import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Projectiles: moving damage spheres for both player and enemies.
// Handles integration, homing, target collision, ground impact, AoE.
// ---------------------------------------------------------------------------

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _prevPos = new THREE.Vector3();

// Squared distance from point (px,py,pz) to segment [a,b] — used so fast
// projectiles can't tunnel through a target between two frames (at dt=0.05
// a 46u/s projectile moves 2.3 units per frame, well past most hit radii).
function distSqPointToSegment(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  let t = abLenSq > 1e-8 ? ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / abLenSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + abx * t), dy = py - (ay + aby * t), dz = pz - (az + abz * t);
  return dx * dx + dy * dy + dz * dz;
}

export class Projectiles {
  constructor(scene, world, effects) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.list = [];
    this.onSpawn = null;   // duel mode: replicate my projectiles to the peer
  }

  spawn({
    pos, vel, owner = 'player', damage = 10, radius = 0.35,
    color = 0xffaa44, coreColor = 0xffffff, size = 0.4,
    gravity = 0, life = 3.5, aoe = 0, aoeDamage = null, pierce = false,
    homing = 0, homingTarget = null, knockback = 6, trailEvery = 0.018,
    onImpact = null, freeze = 0, poison = null, slow = 0,
  }) {
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(size * 0.45, 10, 8),
      new THREE.MeshBasicMaterial({ color: coreColor })
    );
    group.add(core);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex(), color, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(size * 3.2);
    group.add(glow);
    group.position.copy(pos);
    this.scene.add(group);

    this.list.push({
      pos: pos.clone(), vel: vel.clone(), owner, damage, radius, color,
      gravity, life, aoe, aoeDamage, pierce, homing, homingTarget, knockback,
      mesh: group, trailTimer: 0, trailEvery, onImpact, freeze, poison, slow,
      hitSet: pierce ? new Set() : null, dead: false,
    });

    if (this.onSpawn && owner === 'player') {
      this.onSpawn({ pos, vel, color, coreColor, size, radius, gravity, life, aoe });
    }
  }

  update(dt, time, enemies, player) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0 || p.dead) { this._remove(i); continue; }

      // homing steer
      if (p.homing > 0) {
        const target = p.owner === 'enemy'
          ? _v1.copy(player.position).setY(player.position.y + 1.1)
          : (p.homingTarget && p.homingTarget.alive ? _v1.copy(p.homingTarget.position) : null);
        if (target) {
          const desired = _v2.copy(target).sub(p.pos).normalize().multiplyScalar(p.vel.length());
          p.vel.lerp(desired, Math.min(1, p.homing * dt));
        }
      }

      p.vel.y -= p.gravity * dt;
      const prevY = p.pos.y;
      _prevPos.copy(p.pos);
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);

      // trail
      p.trailTimer -= dt;
      if (p.trailTimer <= 0) {
        p.trailTimer = p.trailEvery;
        this.effects.glow(p.pos, { color: p.color, size: p.radius * 2.2, life: 0.22 });
      }

      // ---- collisions ----
      let impacted = false;
      if (p.owner === 'player') {
        for (const e of enemies) {
          if (!e.alive) continue;
          if (p.hitSet && p.hitSet.has(e)) continue;
          const hitR = p.radius + e.radius;
          _v1.copy(e.position); _v1.y += e.height * 0.5;
          if (distSqPointToSegment(_v1.x, _v1.y, _v1.z, _prevPos.x, _prevPos.y, _prevPos.z, p.pos.x, p.pos.y, p.pos.z) < hitR * hitR) {
            this._dealToEnemy(p, e);
            if (p.pierce) { p.hitSet.add(e); }
            else { impacted = true; p.directHit = e; break; }
          }
        }
      } else if (p.owner === 'enemy') {
        // enemy projectile vs player capsule (center at +0.9)
        _v1.copy(player.position); _v1.y += 0.9;
        const hitR = p.radius + 0.62;
        if (player.alive && distSqPointToSegment(_v1.x, _v1.y, _v1.z, _prevPos.x, _prevPos.y, _prevPos.z, p.pos.x, p.pos.y, p.pos.z) < hitR * hitR) {
          player.takeDamage(p.damage, p.pos);
          player.applyKnockback(_v2.copy(p.vel).normalize().multiplyScalar(p.knockback * 0.4).setY(2));
          impacted = true;
        }
      }
      // 'remote' projectiles are cosmetic replicas of the duel opponent's
      // shots — their damage already happens in the opponent's simulation

      // ground impact (swept from prev height)
      if (!impacted) {
        const g = this.world.groundHeightBelow(p.pos.x, p.pos.z, Math.max(prevY, p.pos.y), time, 0.01);
        if (g !== null && p.pos.y <= g + p.radius * 0.5) impacted = true;
      }

      if (impacted) {
        this._impact(p, enemies, player);
        this._remove(i);
      }
    }
  }

  _dealToEnemy(p, e) {
    const kb = _v1.copy(p.vel).normalize().multiplyScalar(p.knockback);
    kb.y = Math.max(kb.y, p.knockback * 0.35);
    e.takeDamage(p.damage, { knockback: kb, source: 'player', freeze: p.freeze, poison: p.poison, slow: p.slow });
    this.effects.burst(p.pos, { count: 10, color: p.color, speed: 6, size: 0.22, life: 0.35 });
  }

  _impact(p, enemies, player) {
    this.effects.burst(p.pos, {
      count: p.aoe > 0 ? 34 : 14, color: p.color, speed: p.aoe > 0 ? 14 : 7,
      size: 0.3, life: 0.5, gravity: 10,
    });
    this.effects.glow(p.pos, { color: p.color, size: p.aoe > 0 ? p.aoe : 1.2, life: 0.28, grow: 3 });
    if (p.aoe > 0) {
      this.effects.ring(p.pos, { color: p.color, endRadius: p.aoe, life: 0.4 });
      const dmg = p.aoeDamage ?? p.damage;
      if (p.owner === 'player') {
        for (const e of enemies) {
          if (!e.alive || e === p.directHit) continue;
          _v1.copy(e.position); _v1.y += e.height * 0.5;
          const d = _v1.distanceTo(p.pos);
          if (d < p.aoe + e.radius) {
            const falloff = 1 - Math.max(0, (d - 1.5)) / p.aoe * 0.6;
            const kb = _v2.copy(_v1).sub(p.pos).normalize().multiplyScalar(p.knockback);
            kb.y = Math.max(kb.y, p.knockback * 0.5);
            e.takeDamage(dmg * falloff, { knockback: kb, source: 'player', freeze: p.freeze, poison: p.poison, slow: p.slow });
          }
        }
      } else if (p.owner === 'enemy') {
        _v1.copy(player.position); _v1.y += 0.9;
        const d = _v1.distanceTo(p.pos);
        if (player.alive && d < p.aoe + 0.6) {
          player.takeDamage(dmg * (1 - d / (p.aoe + 0.6) * 0.5), p.pos);
          player.applyKnockback(_v2.copy(_v1).sub(p.pos).normalize().multiplyScalar(p.knockback * 0.6).setY(4));
        }
      }
    }
    if (p.onImpact) p.onImpact(p.pos);
  }

  _remove(i) {
    const p = this.list[i];
    this.scene.remove(p.mesh);
    p.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.list.splice(i, 1);
  }

  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this._remove(i);
  }
}

let _tex = null;
function glowTex() {
  if (_tex) return _tex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _tex = new THREE.CanvasTexture(c);
  return _tex;
}
