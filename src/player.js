import * as THREE from 'three';
import { clamp, damp, lerp } from './utils.js';
import { World } from './world.js';
import { getSensMult, getAimSensMult } from './settings.js';

// ---------------------------------------------------------------------------
// Player: first-person aerial movement controller.
// Feet-position based; camera rides at eye height with bob/shake/FOV feel.
// Class stats (speed, dash count, health) are injected via setClassStats.
// ---------------------------------------------------------------------------

const GRAVITY = 30;
const EYE_HEIGHT = 1.62;
const RADIUS = 0.5;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _grav = new THREE.Vector3(0, -1, 0);
const _up = new THREE.Vector3(0, 1, 0);
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _euler = new THREE.Euler();

export class Player {
  constructor(world, camera, input) {
    this.world = world;
    this.camera = camera;
    this.input = input;

    this.position = new THREE.Vector3(0, 4, 8); // feet
    this.vel = new THREE.Vector3();
    this.yaw = 0;            // spawn at +Z looking toward the arena center (-Z)
    this.pitch = 0;
    this.baseSensitivity = 0.0021;
    this.sensitivity = this.baseSensitivity * getSensMult();

    // movement stats (class can override some)
    this.walkSpeed = 11;
    this.maxDashes = 3;
    this.dashSpeed = 34;
    this.dashDuration = 0.17;

    this.grounded = false;
    this.up = new THREE.Vector3(0, 1, 0);   // bends near graviton rocks (belt map)
    this._onRock = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpsLeft = 2;
    this.dashCharges = this.maxDashes;
    this.dashRecharge = 0;
    this.dashTimer = 0;
    this.dashDir = new THREE.Vector3();
    this.stallTimer = 0;
    this.slowFallTimer = 0;   // ranged m1s: gentle glide instead of a full stall
    this.rootTimer = 0;       // channeled moves (fist flurry): no move/dash/jump
    this.windBoostT = 0;      // map wind rivers: speed cap raised while riding
    this.recoverAssistUsed = false;
    this.inRecoverZone = false;

    // health/combat
    this.maxHealth = 100;
    this.health = 100;
    this.shield = 0;          // overshield (Warden's Battle Roar etc.)
    this.shieldT = 0;
    this.invulnTimer = 0;
    this.alive = true;

    // camera feel
    this.baseFov = 80;
    this.fov = 80;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.trauma = 0;          // camera shake 0..1
    this.landDip = 0;
    this.tilt = 0;            // strafe lean

    // hooks other systems can listen to
    this.onLand = null;
    this.onDash = null;
    this.onJump = null;
    this.onVoidReset = null;
    this.onDamaged = null;
    this.onDeath = null;

    this.freeze = false;      // menus pause control
    this.suppressCamera = false; // spectate cam owns the camera while dead
  }

  setClassStats({ maxHealth, walkSpeed, maxDashes, dashSpeed, gravityScale }) {
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    if (walkSpeed) this.walkSpeed = walkSpeed;
    if (maxDashes) { this.maxDashes = maxDashes; this.dashCharges = maxDashes; }
    if (dashSpeed) this.dashSpeed = dashSpeed;
    this.gravityScale = gravityScale || 1;   // class passive: <1 falls slower
  }

  get eyePosition() {
    return _v1.copy(this.position).add(_v2.set(0, EYE_HEIGHT, 0));
  }

  forwardDir(includePitch = true) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    if (includePitch) return new THREE.Vector3(-sy * cp, sp, -cy * cp).normalize();
    return new THREE.Vector3(-sy, 0, -cy).normalize();
  }

  // Wish direction from WASD, camera-relative. flat=true keeps it horizontal.
  wishDir(flat = true) {
    const f = this.input.down('forward') ? 1 : 0;
    const b = this.input.down('back') ? 1 : 0;
    const l = this.input.down('left') ? 1 : 0;
    const r = this.input.down('right') ? 1 : 0;
    const fwd = f - b, side = r - l;
    if (!fwd && !side) return null;
    const dir = new THREE.Vector3();
    const forward = this.forwardDir(!flat);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    dir.addScaledVector(forward, fwd).addScaledVector(right, side);
    if (flat) dir.y = 0;
    return dir.lengthSq() > 0 ? dir.normalize() : null;
  }

  airStall(duration = 0.38) {
    this.stallTimer = Math.max(this.stallTimer, duration);
    if (this.vel.y < 0) this.vel.y *= 0.15;
    this.vel.x *= 0.75;
    this.vel.z *= 0.75;
  }

  // gentler than airStall: just soften the fall, keep all horizontal momentum
  slowFall(duration = 0.5) {
    this.slowFallTimer = Math.max(this.slowFallTimer, duration);
  }

  root(duration) {
    this.rootTimer = Math.max(this.rootTimer, duration);
  }

  applyKnockback(v) {
    this.vel.add(v);
    if (v.y > 2) this.grounded = false;
  }

  // jump impulse along the local up (plain vel.y set on normal maps, so
  // classic jump feel is bit-identical there)
  _jumpAlongUp(speed) {
    if (this.up.y > 0.999) {
      this.vel.y = speed;
    } else {
      const inward = this.vel.dot(this.up);
      if (inward < 0) this.vel.addScaledVector(this.up, -inward);
      this.vel.addScaledVector(this.up, speed);
    }
  }

  grantShield(amount, duration) {
    this.shield = Math.max(this.shield, amount);
    this.shieldT = duration;
  }

  takeDamage(amount, sourcePos = null, opts = {}) {
    // pierceInvuln: network PvP hits are attacker-confirmed discrete events —
    // the local i-frame window must never eat them (it exists for PvE swarms)
    if (!this.alive || (this.invulnTimer > 0 && !opts.pierceInvuln)) return false;
    amount *= 1 - (this.damageReduction || 0);
    amount *= this.damageTakenMult || 1;   // sorcerer's nuke channel: 1.5x
    // overshield absorbs first
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      amount -= absorbed;
      if (amount <= 0) {
        this.trauma = Math.min(1, this.trauma + 0.2);
        this.invulnTimer = 0.15;
        this.lastDamagedAt = this._simTimeRef ? this._simTimeRef() : 0;
        return true;
      }
    }
    this.health -= amount;
    this.lastDamagedAt = this._simTimeRef ? this._simTimeRef() : 0;
    this.trauma = Math.min(1, this.trauma + 0.45);
    this.invulnTimer = 0.25;
    if (this.onDamaged) this.onDamaged(amount, sourcePos);
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      if (this.onDeath) this.onDeath();
    }
    return true;
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  // poison DoT (Void Stalker missiles): refreshes rather than stacks
  applyPoison(t, dps) {
    if (!this.alive) return;
    this.poisonT = Math.max(this.poisonT || 0, t);
    this.poisonDps = Math.max(this.poisonDps || 0, dps);
  }

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  respawn() {
    this.position.copy(this.world.soloSpawn);
    this.vel.set(0, 0, 0);
    this.health = this.maxHealth;
    this.shield = 0;
    this.shieldT = 0;
    this.alive = true;
    this.poisonT = 0;
    this.poisonDps = 0;
    this.damageTakenMult = 1;
    this.dashCharges = this.maxDashes;
    this.jumpsLeft = 2;
    this.stallTimer = 0;
    this.slowFallTimer = 0;
    this.rootTimer = 0;
    this.dashTimer = 0;
    this.lastDamagedAt = -999;
  }

  applySensitivity() {
    this.sensitivity = this.baseSensitivity * getSensMult();
  }

  update(dt, time) {
    if (this.invulnTimer > 0) this.invulnTimer -= dt;
    if (this.shieldT > 0) {
      this.shieldT -= dt;
      if (this.shieldT <= 0) this.shield = 0;
    }
    if (this.freeze || !this.alive) {
      if (!this.suppressCamera) this._updateCamera(dt, time);
      return;
    }

    // ---- look ----
    const [dx, dy] = this.input.consumeLook();
    this.lastLookDX = dx;
    this.lastLookDY = dy;
    // holding right click steadies the aim: look speed drops to the aim fraction
    const sens = this.sensitivity * (this.input.altDown() ? getAimSensMult() : 1);
    this.yaw -= dx * sens;
    this.pitch = clamp(this.pitch - dy * sens, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);

    // ---- timers ----
    this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.input.pressed('jump')) this.jumpBuffer = 0.12;
    if (this.poisonT > 0) {
      this.poisonT -= dt;
      this.poisonTick = (this.poisonTick ?? 0) - dt;
      if (this.poisonTick <= 0) {
        this.poisonTick = 0.5;
        const d = this.poisonDps * 0.5;
        this.health -= d;
        this.lastDamagedAt = this._simTimeRef ? this._simTimeRef() : 0;
        this.trauma = Math.min(1, this.trauma + 0.08);
        if (this.onDamaged) this.onDamaged(d, null);
        if (this.health <= 0) {
          this.health = 0;
          this.alive = false;
          if (this.onDeath) this.onDeath();
        }
      }
      if (this.poisonT <= 0) this.poisonDps = 0;
    }
    if (this.stallTimer > 0) this.stallTimer -= dt;
    if (this.slowFallTimer > 0) this.slowFallTimer -= dt;
    if (this.rootTimer > 0) this.rootTimer -= dt;
    if (this.dashTimer > 0) this.dashTimer -= dt;
    if (this.windBoostT > 0) this.windBoostT -= dt;
    const rooted = this.rootTimer > 0;

    // dash recharge: fast on the ground, slow (but not zero) in the air
    if (this.dashCharges < this.maxDashes) {
      this.dashRecharge += dt * (this.grounded ? 2.1 : 0.6);
      if (this.dashRecharge >= 1) {
        this.dashRecharge = 0;
        this.dashCharges++;
      }
    }

    // ---- dash ----
    if (!rooted && this.input.pressed('dash') && this.dashCharges > 0 && this.dashTimer <= 0) {
      const wish = this.wishDir(this.grounded);
      let dir = wish || this.forwardDir(!this.grounded);
      // airborne + holding jump: bias the dash upward for recovery/verticality
      if (!this.grounded && this.input.down('jump')) {
        dir = dir.clone(); dir.y = Math.max(dir.y, 0.65); dir.normalize();
      }
      this.dashCharges--;
      // air dashes carry you much farther than ground dashes
      this.dashLen = this.grounded ? 0.18 : 0.28;
      this.dashTimer = this.dashLen;
      this.dashDir.copy(dir);
      // momentum: a dash never slows you below the speed you brought in
      this.dashEntrySpeed = this.vel.length();
      this.stallTimer = 0;
      this.grounded = false;
      if (this.onDash) this.onDash(dir);
    }

    // ---- movement forces ----
    if (rooted) {
      // channeled in place: no drift, hang if airborne
      this.vel.x = 0;
      this.vel.z = 0;
      this.vel.y = Math.max(this.vel.y - GRAVITY * 0.1 * dt, -1.5);
    } else if (this.dashTimer > 0) {
      const t = this.dashTimer / (this.dashLen || this.dashDuration); // 1 -> 0
      const speed = Math.max(this.dashSpeed * (0.55 + 0.45 * t), this.dashEntrySpeed || 0);
      this.vel.copy(this.dashDir).multiplyScalar(speed);
    } else {
      const wish = this.wishDir(true);
      const stalled = this.stallTimer > 0 && !this.grounded;
      const accel = this.grounded ? 70 : 26;
      if (wish && !stalled) {
        this.vel.x += wish.x * accel * dt;
        this.vel.z += wish.z * accel * dt;
      }
      // air-stall locks you in place: you hang, you don't drift
      if (stalled) {
        const hold = Math.exp(-10 * dt);
        this.vel.x *= hold;
        this.vel.z *= hold;
      }
      // clamp horizontal speed (soft when airborne so dashes carry momentum)
      // speedMul: class buff/debuff channel (Gambler) — composes with
      // walkSpeed itself, which PvP slows overwrite directly
      const hv = _v1.set(this.vel.x, 0, this.vel.z);
      const hs = hv.length();
      const maxH = this.walkSpeed * (this.speedMul || 1) + (this.windBoostT > 0 ? 40 : 0);
      if (hs > maxH) {
        const over = hs - maxH;
        const decel = (this.grounded ? 60 : 8) * dt;
        const newSpeed = hs - Math.min(over, decel + over * (this.grounded ? 0.35 : 0.04));
        hv.multiplyScalar(newSpeed / hs);
        this.vel.x = hv.x; this.vel.z = hv.z;
      }
      // friction when idle on ground
      if (this.grounded && !wish) {
        const f = Math.exp(-9 * dt);
        this.vel.x *= f; this.vel.z *= f;
      }
      // gravity (reduced heavily during air-stall, softly during slow-fall);
      // direction + strength come from the world so graviton rocks can bend
      // it — on normal maps this is exactly the old straight-down pull
      const g = (this.stallTimer > 0 ? GRAVITY * 0.12
        : this.slowFallTimer > 0 ? GRAVITY * 0.45 : GRAVITY) * (this.gravityScale || 1);
      const gMul = this.world.gravityAt(this.position, _grav);
      this.vel.addScaledVector(_grav, g * gMul * dt);
      if (this.stallTimer > 0 && this.vel.y < -3) this.vel.y = -3;
      if (this.slowFallTimer > 0 && this.vel.y < -7) this.vel.y = -7;
    }
    // smoothed "up": opposite the local gravity (identity on normal maps)
    this.world.gravityAt(this.position, _grav);
    this.up.lerp(_v2.copy(_grav).negate(), 1 - Math.exp(-6 * dt)).normalize();

    // ---- jump ----
    if (this.jumpBuffer > 0 && !rooted) {
      if (this.grounded || this.coyote > 0) {
        this._jumpAlongUp(13);
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.jumpsLeft = 1;
        if (this.onJump) this.onJump(false);
      } else if (this.jumpsLeft > 0) {
        this._jumpAlongUp(12);
        this.jumpsLeft--;
        this.jumpBuffer = 0;
        // double jump gives a little directional boost
        const wish = this.wishDir(true);
        if (wish) { this.vel.x += wish.x * 4; this.vel.z += wish.z * 4; }
        if (this.onJump) this.onJump(true);
      }
    }

    // ---- integrate ----
    const prevY = this.position.y;
    this.position.addScaledVector(this.vel, dt);

    // ---- ground collision (swept: use pre-move height so fast falls can't tunnel) ----
    const wasGrounded = this.grounded;
    const ground = this.world.groundHeightBelow(
      this.position.x, this.position.z,
      Math.max(prevY, this.position.y), time,
      wasGrounded ? 0.75 : 0.05
    );
    this.grounded = false;
    if (ground !== null) {
      const snapDist = wasGrounded ? 0.6 : 0;
      if (this.position.y <= ground + 0.001 + snapDist && this.vel.y <= 0.01) {
        if (!wasGrounded && this.vel.y < -9) {
          this.landDip = Math.min(0.5, -this.vel.y * 0.016);
          if (this.onLand) this.onLand(-this.vel.y);
        }
        this.position.y = ground;
        this.vel.y = 0;
        this.grounded = true;
        this.jumpsLeft = 2;
        this.recoverAssistUsed = false;
      }
    }

    // orbiting platforms carry their rider: inherit the ground's frame delta
    if (this.grounded &&
        this.world.platformCarry(this.position.x, this.position.z, this.position.y, time, dt, _v2)) {
      this.position.add(_v2);
    }

    // ---- island solid-volume collision -------------------------------
    // groundHeightBelow above only ever *lands* you on top surfaces (it
    // requires vel.y <= 0.01), so nothing ever stopped upward motion from
    // underneath an island — you could fly up through the rock and pop out
    // the top. Islands have a real underside (see World.islandBottomAt);
    // treat the whole [bottom, top] span as solid and push out of it based
    // on which way the player entered it:
    //   - from above: embedded-recovery case (fast fall past the swept
    //     ground check above) — snap onto the top surface.
    //   - from below: rising into the underside — bonk, don't tunnel through.
    //   - laterally (e.g. falling past the side of the island): push the
    //     player back out horizontally past the island's edge, keeping
    //     their vertical motion intact, instead of teleporting them.
    for (const isl of this.world.islands) {
      const top = World.islandHeightAt(isl, this.position.x, this.position.z);
      if (top === null) continue;
      const bottom = World.islandBottomAt(isl, this.position.x, this.position.z);
      if (bottom === null || this.position.y >= top || this.position.y <= bottom) continue;
      // resolve through the NEAREST surface, so contact is a smooth slide
      // (classifying by entry direction caused sudden sideways shoves when
      // gliding along the underside)
      const dx = this.position.x - isl.x, dz = this.position.z - isl.z;
      const d = Math.hypot(dx, dz);
      const theta = Math.atan2(dz, dx);
      const edge = World.edgeRadius(isl, theta);
      const dBot = this.position.y - bottom;   // depth from the underside
      const dSide = edge - d;                  // depth from the side wall
      if (prevY >= top - 0.05) {
        // genuinely came from above: embedded-recovery, land on top
        this.position.y = top;
        this.vel.y = 0;
        this.grounded = true;
        this.jumpsLeft = 2;
      } else if (dBot <= dSide) {
        // nearest exit is the underside: slide along the belly (the bottom
        // surface is continuous, so following it frame-to-frame is smooth)
        this.position.y = bottom;
        if (this.vel.y > 0) this.vel.y = 0;
      } else {
        // nearest exit is the side wall: push out only as far as we sank in
        const targetD = edge + 0.05;
        const nx = d > 0.0001 ? dx / d : 1;
        const nz = d > 0.0001 ? dz / d : 0;
        this.position.x = isl.x + nx * targetD;
        this.position.z = isl.z + nz * targetD;
        // cancel velocity into the island
        const into = this.vel.x * nx + this.vel.z * nz;
        if (into < 0) { this.vel.x -= into * nx; this.vel.z -= into * nz; }
      }
    }

    // ---- column collision (horizontal push-out) ----
    for (const c of this.world.columns) {
      if (this.position.y > c.yTop || this.position.y + EYE_HEIGHT < c.yBottom) continue;
      const dx = this.position.x - c.x, dz = this.position.z - c.z;
      const d = Math.hypot(dx, dz);
      const minD = c.r + RADIUS;
      if (d < minD && d > 0.0001) {
        const push = (minD - d) / d;
        this.position.x += dx * push;
        this.position.z += dz * push;
        // cancel velocity into the column
        const nx = dx / d, nz = dz / d;
        const into = this.vel.x * nx + this.vel.z * nz;
        if (into < 0) { this.vel.x -= into * nx; this.vel.z -= into * nz; }
      }
    }

    // ---- graviton rock surfaces: land on and walk around asteroids ----
    this._onRock = false;
    for (const rk of this.world.gravRocks || []) {
      const d = _v1.copy(this.position).sub(rk.center);
      const dist = d.length();
      if (dist < rk.r + 0.05 && dist > 0.0001) {
        d.multiplyScalar(1 / dist);              // outward surface normal
        this.position.copy(rk.center).addScaledVector(d, rk.r + 0.02);
        const into = this.vel.dot(d);
        if (into < 0) {
          this.vel.addScaledVector(d, -into);    // cancel motion into the rock
          if (into < -9 && !this.grounded && this.onLand) this.onLand(-into);
        }
        this.grounded = true;
        this._onRock = true;
        this.jumpsLeft = 2;
        this.recoverAssistUsed = false;
      }
    }

    // ---- graviton plates: land on the pulling face ----
    for (const pl of this.world.gravPlates || []) {
      _v1.copy(this.position).sub(pl.center);
      const h = _v1.dot(pl.normal);
      const lx = _v1.dot(pl.t1), lz = _v1.dot(pl.t2);
      if (Math.abs(lx) > pl.w / 2 + 0.2 || Math.abs(lz) > pl.d / 2 + 0.2) continue;
      if (h > 0.42 || h < -0.6) continue;
      // snap feet onto the slab's top face (half-thickness 0.35)
      this.position.addScaledVector(pl.normal, 0.37 - h);
      const into = this.vel.dot(pl.normal);
      if (into < 0) {
        this.vel.addScaledVector(pl.normal, -into);
        if (into < -9 && !this.grounded && this.onLand) this.onLand(-into);
      }
      this.grounded = true;
      this._onRock = true;
      this.jumpsLeft = 2;
      this.recoverAssistUsed = false;
    }

    // ---- void recovery ----
    this.inRecoverZone = this.position.y < -45;
    if (this.inRecoverZone && !this.recoverAssistUsed) {
      // one free full dash refill per fall, so you can climb back
      this.dashCharges = this.maxDashes;
      this.jumpsLeft = Math.max(this.jumpsLeft, 1);
      this.recoverAssistUsed = true;
    }
    if (this.position.y < -110) {
      this.position.copy(this.world.soloSpawn).y += 2;
      this.vel.set(0, 0, 0);
      this.trauma = 1;
      this.invulnTimer = 1.2;
      this.health = Math.max(1, this.health - this.maxHealth * 0.15);
      if (this.onVoidReset) this.onVoidReset();
    }

    this._updateCamera(dt, time);
  }

  _updateCamera(dt, time) {
    // FOV: widen during dashes and fast falls
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    const fast = this.dashTimer > 0 || hSpeed > this.walkSpeed * 1.6;
    const targetFov = this.baseFov + (fast ? 10 : 0) + clamp(-this.vel.y * 0.08, 0, 5);
    this.fov = damp(this.fov, targetFov, 8, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // view bob while walking on the ground
    const walking = this.grounded && hSpeed > 1.5;
    this.bobAmount = damp(this.bobAmount, walking ? 1 : 0, 8, dt);
    if (walking) this.bobPhase += dt * (7 + hSpeed * 0.35);
    const bobY = Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * 0.02 * this.bobAmount;

    // landing dip decays
    this.landDip = damp(this.landDip, 0, 10, dt);

    // strafe tilt
    const strafe = (this.input.down('right') ? 1 : 0) - (this.input.down('left') ? 1 : 0);
    this.tilt = damp(this.tilt, strafe * -0.018, 10, dt);

    // camera shake from trauma
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const sh = this.trauma * this.trauma;
    const shakeYaw = (Math.sin(time * 61) + Math.sin(time * 41 + 2)) * 0.012 * sh;
    const shakePitch = (Math.sin(time * 53 + 1) + Math.sin(time * 37 + 4)) * 0.012 * sh;
    const shakePos = 0.12 * sh;

    if (this.up.y > 0.9999) {
      // normal maps: the original euler camera, untouched
      this.camera.position.set(
        this.position.x + bobX + (Math.sin(time * 47) * shakePos),
        this.position.y + EYE_HEIGHT + bobY - this.landDip + (Math.sin(time * 43 + 1) * shakePos),
        this.position.z
      );
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(
        this.pitch + shakePitch,
        this.yaw + shakeYaw,
        this.tilt
      );
    } else {
      // bent gravity: eye rides along the local up, and the whole yaw/pitch
      // frame is re-based onto it so the horizon rolls with the rock
      this.camera.position.set(
        this.position.x + this.up.x * EYE_HEIGHT + bobX + (Math.sin(time * 47) * shakePos),
        this.position.y + this.up.y * EYE_HEIGHT + bobY - this.landDip + (Math.sin(time * 43 + 1) * shakePos),
        this.position.z + this.up.z * EYE_HEIGHT
      );
      _q1.setFromUnitVectors(_up, this.up);
      _euler.set(this.pitch + shakePitch, this.yaw + shakeYaw, this.tilt, 'YXZ');
      this.camera.quaternion.copy(_q1).multiply(_q2.setFromEuler(_euler));
    }
  }
}
