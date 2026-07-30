import * as THREE from 'three';

// ---------------------------------------------------------------------------
// The five classes. EVERY ability is hold-to-charge (ctx.chargePower 0..1):
// tap for the quick version, hold to hang in the air and unleash more.
// Each ability's execute(ctx, state) may:
//   return false  -> refuse the cast (no cooldown spent)
//   return number -> use that as this cast's cooldown
// ---------------------------------------------------------------------------

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// void poison every Shadow Assassin attack applies
function voidPoison(mult = 1) {
  return { dps: 4 * mult, t: 3 };
}

// ---- rift anchor helpers (mage E) ----
function buildRiftMesh() {
  const g = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xbb88ff, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.06, 8, 32), ringMat);
  ring.position.y = 1.1;
  g.add(ring);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 8, 24), ringMat.clone());
  inner.position.y = 1.1;
  inner.rotation.x = Math.PI / 2;
  g.add(inner);
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.22, 0),
    new THREE.MeshBasicMaterial({ color: 0xe8ccff, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95, depthWrite: false })
  );
  core.position.y = 1.1;
  g.add(core);
  const light = new THREE.PointLight(0xbb88ff, 4, 8, 2);
  light.position.y = 1.3;
  g.add(light);
  return g;
}

function removeAnchor(ctx, state) {
  if (!state.anchor) return;
  ctx.game.scene.remove(state.anchor.mesh);
  state.anchor.mesh.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  state.anchor = null;
}

// ---- sorcerer orb meshes ----
function buildBlueOrb() {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 24, 18),
    new THREE.MeshBasicMaterial({
      color: 0x3366ff, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  g.add(shell);
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xbbddff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  g.add(core);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.6, 0.07, 8, 40),
    new THREE.MeshBasicMaterial({
      color: 0x66aaff, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  ring.rotation.x = Math.PI / 2.6;
  g.add(ring);
  const light = new THREE.PointLight(0x4488ff, 8, 20, 2);
  g.add(light);
  const pull = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 24),
    new THREE.MeshBasicMaterial({
      color: 0x4488ff, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  pull.name = 'pullRadius';
  g.add(pull);
  const pullEdge = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 24),
    new THREE.MeshBasicMaterial({
      color: 0x66aaff, transparent: true, opacity: 0.1, wireframe: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  pullEdge.name = 'pullRadiusEdge';
  g.add(pullEdge);
  return g;
}

function buildPurpleOrb() {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1.0, 24, 18),
    new THREE.MeshBasicMaterial({
      color: 0xa64dff, transparent: true, opacity: 0.14,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  g.add(shell);
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xf0e0ff, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  g.add(core);
  const light = new THREE.PointLight(0xa64dff, 2, 24, 2);
  light.name = 'nukeLight';
  g.add(light);
  return g;
}

// focus reticle (assassin targeting)
function buildFocusMesh() {
  const mat = new THREE.SpriteMaterial({
    color: 0xff44aa, transparent: true, opacity: 0.95,
    depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    map: diamondTexture(),
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(0.9);
  s.renderOrder = 999;
  return s;
}

let _diamondTex = null;
function diamondTexture() {
  if (_diamondTex) return _diamondTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.translate(32, 32);
  ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = 5;
  ctx.strokeRect(-14, -14, 28, 28);
  _diamondTex = new THREE.CanvasTexture(c);
  return _diamondTex;
}

export const CLASSES = {
  // ========================================================== ARCANE MAGE ==
  mage: {
    id: 'mage',
    name: 'Arcane Mage',
    role: 'Long-range artillery',
    tagline: 'Fragile. Devastating. Keep your distance and rain ruin.',
    color: 0x66ccff,
    stats: { maxHealth: 70, walkSpeed: 11, maxDashes: 3, dashSpeed: 40 },
    update(ctx, dt, state) {
      // rift anchor: spins, pulses, expires
      if (state.anchor) {
        const a = state.anchor;
        a.t -= dt;
        a.mesh.rotation.y += dt * 2.2;
        const pulse = 1 + Math.sin(ctx.game.simTime * 5) * 0.08;
        a.mesh.scale.setScalar(pulse);
        if (Math.random() < dt * 6) {
          ctx.effects.glow(a.pos.clone().add(_v1.set(0, 1.1, 0)), { color: 0xbb88ff, size: 0.8, life: 0.3 });
        }
        if (a.t <= 0) {
          ctx.effects.burst(a.pos.clone().add(_v1.set(0, 1, 0)), { count: 14, color: 0x8866cc, speed: 5, size: 0.2, life: 0.35 });
          removeAnchor(ctx, state);
          // expired unused: give most of the cooldown back
          ctx.game.combat.cooldowns.E = Math.min(ctx.game.combat.cooldowns.E, 2);
        }
      }
    },
    basic: {
      name: 'Firebolt',
      desc: 'Rapid-fire explosive bolt. Firing in the air softens your fall.',
      cooldown: 0.3,
      execute(ctx) {
        ctx.slowFallIfAirborne(0.5);
        ctx.viewmodel.trigger('cast');
        const dir = ctx.aimDir();
        ctx.projectiles.spawn({
          pos: ctx.muzzle(), vel: dir.multiplyScalar(58),
          damage: 11, aoe: 1.7, aoeDamage: 7, color: 0xff9944, size: 0.42,
          knockback: 6,
        });
        ctx.effects.glow(ctx.muzzle(), { color: 0xffbb66, size: 0.8, life: 0.12 });
        ctx.audio?.play('firebolt');
      },
    },
    abilities: [
      {
        slot: 'Q', name: 'Arcane Beam', cooldown: 5, chargeable: true,
        desc: 'Piercing beam. Charge for a thicker, harder lance.',
        execute(ctx) {
          const p = ctx.chargePower || 0;
          ctx.stallIfAirborne(0.55);
          ctx.viewmodel.trigger('heavy');
          const from = ctx.muzzle();
          const dir = ctx.aimDir();
          const range = 70;
          const hits = ctx.rayHits(from, dir, range, 1.1 + p * 0.6);
          for (const e of hits) {
            ctx.dealDamage(e, 32 * (1 + 0.7 * p), { knockback: _v1.copy(dir).multiplyScalar(10 + 6 * p).setY(4) });
          }
          const end = _v2.copy(from).addScaledVector(dir, range);
          ctx.effects.beam(from, end, { color: 0x66ccff, radius: 0.22 + p * 0.2, life: 0.28 + p * 0.15 });
          ctx.effects.burst(from, { count: 12 + Math.floor(p * 14), color: 0x99e6ff, speed: 5, size: 0.2, life: 0.3 });
          ctx.shake(0.3 + 0.25 * p);
          ctx.audio?.play('beam');
        },
      },
      {
        slot: 'E', name: 'Rift Anchor', cooldown: 9, chargeable: true,
        desc: 'Plant a rift. Cast again — from anywhere — to snap back to it. Charged recall detonates on arrival.',
        execute(ctx, state) {
          const pow = ctx.chargePower || 0;
          const p = ctx.player;
          if (state.anchor) {
            // recall: snap back to the rift
            ctx.effects.burst(p.position.clone().add(_v1.set(0, 1, 0)), { count: 22, color: 0xbb88ff, speed: 8, size: 0.26, life: 0.4, gravity: 0 });
            p.position.copy(state.anchor.pos);
            p.vel.multiplyScalar(0.15);
            p.invulnTimer = Math.max(p.invulnTimer, 0.45);
            ctx.effects.burst(p.position.clone().add(_v1.set(0, 1, 0)), { count: 30, color: 0xdd99ff, speed: 10, size: 0.3, life: 0.5, gravity: 0 });
            ctx.effects.ring(p.position.clone().add(_v1.set(0, 1, 0)), { color: 0xbb88ff, endRadius: 3, life: 0.4, axis: 'x' });
            if (pow > 0.25) {
              // charged recall: arrival nova
              const c = p.position.clone(); c.y += 1;
              for (const e of ctx.sphereHit(c, 6)) {
                ctx.dealDamage(e, 24 * pow, { knockback: _v1.copy(e.position).sub(c).normalize().multiplyScalar(10).setY(6) });
              }
              ctx.effects.ring(c, { color: 0xdd99ff, endRadius: 6, life: 0.4 });
              ctx.effects.impactBurst(c, { color: 0xdd99ff, size: 3 });
            }
            removeAnchor(ctx, state);
            ctx.audio?.play('blink');
            return 9;
          }
          // plant the anchor
          const mesh = buildRiftMesh();
          mesh.position.copy(p.position);
          ctx.game.scene.add(mesh);
          state.anchor = { pos: p.position.clone(), t: 12 + pow * 8, mesh };
          ctx.effects.ring(p.position.clone().add(_v1.set(0, 0.2, 0)), { color: 0xbb88ff, endRadius: 2, life: 0.4 });
          ctx.audio?.play('mark');
          return 0.8;
        },
      },
      {
        slot: 'R', name: 'Meteor Call', cooldown: 12, chargeable: true,
        desc: 'Call a meteor onto the aimed ground. Charge for a bigger rock.',
        execute(ctx) {
          const p = ctx.chargePower || 0;
          const target = ctx.aimGroundPoint(48);
          if (!target) return false;
          const aoe = 6.5 + 2.5 * p;
          ctx.viewmodel.trigger('heavy');
          ctx.effects.marker(target, { color: 0xff6633, radius: aoe, life: 0.85 });
          ctx.audio?.play('meteorCall');
          ctx.delay(0.85, () => {
            const start = target.clone(); start.y += 30;
            ctx.projectiles.spawn({
              pos: start, vel: new THREE.Vector3(0, -42, 0),
              damage: 55 * (1 + 0.6 * p), aoe, color: 0xff7733, coreColor: 0xffe0aa,
              size: 1.5 + p * 0.7, knockback: 15 + 6 * p, trailEvery: 0.008, life: 2,
              onImpact: (pos) => {
                ctx.shake(0.55 + 0.2 * p);
                ctx.game.hitstop(0.09);
                ctx.game.hud?.flash('rgba(255, 130, 60, 0.18)', 0.3);
                ctx.effects.impactBurst(pos, { color: 0xffb266, size: 5 + p * 2 });
                ctx.audio?.play('meteorHit');
              },
            });
          });
        },
      },
      {
        slot: 'F', name: 'Frost Nova', cooldown: 9, chargeable: true,
        desc: 'Freeze and shove everything near you. Charge to deepen the freeze.',
        execute(ctx) {
          const p = ctx.chargePower || 0;
          ctx.stallIfAirborne(0.6);
          const c = ctx.player.position.clone(); c.y += 1;
          const radius = 8.5 + 3 * p;
          const hits = ctx.sphereHit(c, radius);
          for (const e of hits) {
            const kb = _v1.copy(e.position).sub(c).normalize().multiplyScalar(11 + 4 * p).setY(5);
            ctx.dealDamage(e, 16 * (1 + 0.6 * p), { knockback: kb, freeze: 2.2 + 1.2 * p });
          }
          ctx.effects.ring(c, { color: 0x9fdcff, endRadius: radius, life: 0.5, thickness: 0.5 });
          ctx.effects.burst(c, { count: 40, color: 0xcfeeff, color2: 0x77bbee, speed: 12, size: 0.3, life: 0.6, gravity: 4 });
          ctx.shake(0.2);
          ctx.audio?.play('frost');
        },
      },
    ],
  },

  // ========================================================== IRON BRAWLER ==
  brawler: {
    id: 'brawler',
    name: 'Iron Brawler',
    role: 'Close-range bruiser',
    tagline: 'Get in their face and stay there.',
    playstyle: 'Explosive brawling. Rocket Charge into the fight, crash down with Meteor Slam, lock a target down with the Hundred Fists flurry, and blast stragglers with a concussive shockwave.',
    color: 0xff8833,
    stats: { maxHealth: 120, walkSpeed: 12, maxDashes: 3, dashSpeed: 41 },
    update(ctx, dt, state) {
      const p = ctx.player;
      // --- rocket charge: fly along the aim, detonate at the stop ---
      if (state.chargeT > 0) {
        state.chargeT -= dt;
        p.vel.copy(state.chargeDir).multiplyScalar(40);
        p.stallTimer = 0;
        const c = _v1.copy(p.position).addScaledVector(state.chargeDir, 1.4); c.y += 1;
        for (const e of ctx.sphereHit(c, 2.3)) {
          if (state.chargeHit.has(e)) continue;
          state.chargeHit.add(e);
          ctx.dealDamage(e, 12, { knockback: _v2.copy(state.chargeDir).multiplyScalar(7).setY(5) });
        }
        ctx.effects.glow(c, { color: 0xff8833, size: 1.1, life: 0.14 });
        // stop: timer out, or slammed into ground while diving
        const ground = ctx.world.groundHeightBelow(p.position.x, p.position.z, p.position.y + 0.4, ctx.game.simTime, 0.35);
        const crashed = ground !== null && p.position.y <= ground + 0.35 && state.chargeDir.y < -0.15;
        if (state.chargeT <= 0 || crashed) {
          state.chargeT = 0;
          const pow = state.chargePow || 0;
          const c2 = p.position.clone(); c2.y += 0.9;
          const R = 5 + pow * 2.5;
          for (const e of ctx.sphereHit(c2, R)) {
            const kb = _v1.copy(e.position).sub(c2).normalize().multiplyScalar(11 + 5 * pow).setY(9 + 4 * pow);
            ctx.dealDamage(e, 26 * (1 + 0.8 * pow), { knockback: kb });
          }
          ctx.effects.ring(c2, { color: 0xffaa55, endRadius: R, life: 0.5, thickness: 0.6 });
          ctx.effects.burst(c2, { count: 36, color: 0xffcc66, color2: 0xff6622, speed: 14, size: 0.34, life: 0.55 });
          ctx.effects.impactBurst(c2, { color: 0xffb266, size: 4 + pow * 1.5 });
          ctx.game.hitstop(0.08);
          ctx.game.hud?.flash('rgba(255, 150, 60, 0.15)', 0.25);
          ctx.shake(0.5);
          p.vel.multiplyScalar(0.12);
          ctx.audio?.play('explosion');
        }
      }
      // --- meteor slam: explode on landing ---
      if (state.slamming) {
        p.vel.y = Math.min(p.vel.y, -42);
        if (p.grounded) {
          state.slamming = false;
          const pow = state.slamPow || 0;
          const c = p.position.clone();
          const R = 7.5 + pow * 2.5;
          for (const e of ctx.sphereHit(c, R)) {
            const kb = _v1.copy(e.position).sub(c).normalize().multiplyScalar(9).setY(13 + 4 * pow);
            ctx.dealDamage(e, 32 * (1 + 0.6 * pow), { knockback: kb });
          }
          ctx.effects.ring(c, { color: 0xffaa55, endRadius: R, life: 0.5, thickness: 0.6 });
          ctx.effects.burst(c, { count: 40, color: 0xccaa77, color2: 0x7a6a55, speed: 13, size: 0.35, life: 0.6, additive: false });
          ctx.effects.impactBurst(c.clone().add(_v2.set(0, 1, 0)), { color: 0xffd9a0, size: 4.5 });
          ctx.game.hitstop(0.08);
          ctx.shake(0.6);
          ctx.audio?.play('slam');
        }
      }
      // --- hundred fists: rooted flurry that locks enemies (and you) in place ---
      if (state.flurryT > 0) {
        state.flurryT -= dt;
        p.root(0.12);   // refreshed every frame while the flurry runs
        state.flurryTick -= dt;
        if (state.flurryTick <= 0) {
          state.flurryTick = 0.09;
          ctx.viewmodel.trigger('punch');
          const hits = ctx.meleeHit(4.4, 3.6);
          for (const e of hits) {
            // freeze refreshed every punch: they cannot move for the duration
            ctx.dealDamage(e, 5.5 * (1 + 0.6 * state.flurryPow), { freeze: 0.35 });
            ctx.effects.burst(e.center(new THREE.Vector3()), {
              count: 4, color: 0xffcc66, speed: 5, size: 0.18, life: 0.22,
            });
          }
          if (hits.length) { ctx.shake(0.05); ctx.audio?.play('punchHit'); }
          else if (Math.random() < 0.4) ctx.audio?.play('whoosh');
        }
        if (state.flurryT <= 0) {
          // finisher: one big cross that sends them flying
          ctx.viewmodel.trigger('heavy');
          const fwd = p.forwardDir(true);
          for (const e of ctx.meleeHit(4.8, 4)) {
            ctx.dealDamage(e, 22 * (1 + 0.6 * state.flurryPow), {
              knockback: _v1.copy(fwd).multiplyScalar(16).setY(7),
            });
            ctx.effects.impactBurst(e.center(new THREE.Vector3()), { color: 0xffb266, size: 2.6 });
          }
          ctx.game.hitstop(0.07);
          ctx.shake(0.35);
          ctx.audio?.play('slam');
        }
      }
    },
    basic: {
      name: 'Haymaker',
      desc: 'Heavy alternating punches. Hits everything in a wide box in front of you.',
      cooldown: 0.32,
      execute(ctx) {
        ctx.stallIfAirborne(0.3);
        ctx.viewmodel.trigger('punch');
        const hits = ctx.meleeHit(3.6, 3.2);
        const fwd = ctx.player.forwardDir(true);
        for (const e of hits) {
          const kb = _v1.copy(fwd).multiplyScalar(8).setY(4);
          ctx.dealDamage(e, 16, { knockback: kb });
          ctx.effects.burst(e.position.clone().setY(e.position.y + e.height * 0.6), {
            count: 10, color: 0xffffff, speed: 6, size: 0.22, life: 0.3,
          });
        }
        if (hits.length) { ctx.shake(0.12); ctx.game.hitstop(0.03); ctx.audio?.play('punchHit'); }
        else ctx.audio?.play('whoosh');
      },
    },
    abilities: [
      {
        slot: 'Q', name: 'Rocket Charge', cooldown: 6, chargeable: true,
        desc: 'Launch along your aim — any direction — and detonate where you stop.',
        execute(ctx, state) {
          const p = ctx.chargePower || 0;
          state.chargeT = 0.3 + p * 0.18;   // charged = farther
          state.chargePow = p;
          state.chargeHit = new Set();
          state.chargeDir = ctx.aimDir();
          ctx.player.grounded = false;
          ctx.player.invulnTimer = Math.max(ctx.player.invulnTimer, 0.25);
          ctx.viewmodel.trigger('heavy');
          ctx.effects.dashStreaks(ctx.camera);
          ctx.audio?.play('charge');
        },
      },
      {
        slot: 'E', name: 'Meteor Slam', cooldown: 8, chargeable: true,
        desc: 'Crash straight down; the landing detonates. Charge for a wider crater.',
        execute(ctx, state) {
          const pow = ctx.chargePower || 0;
          const p = ctx.player;
          state.slamPow = pow;
          if (p.grounded) {
            p.vel.y = 14;
            p.grounded = false;
            ctx.delay(0.28, () => { state.slamming = true; });
          } else {
            state.slamming = true;
          }
          ctx.viewmodel.trigger('heavy');
          ctx.audio?.play('charge');
        },
      },
      {
        slot: 'R', name: 'Hundred Fists', cooldown: 10, chargeable: true,
        desc: 'A rooted flurry of punches: enemies caught in it cannot move — neither can you. Ends in a launching cross. Charge for a longer, harder flurry.',
        execute(ctx, state) {
          const pow = ctx.chargePower || 0;
          state.flurryT = 1.2 + 0.9 * pow;
          state.flurryTick = 0;
          state.flurryPow = pow;
          ctx.player.root(0.15);
          ctx.effects.ring(ctx.player.position.clone().add(_v1.set(0, 1.1, 0)), {
            color: 0xffaa55, endRadius: 2.5, life: 0.3, axis: 'x', thickness: 0.3,
          });
          ctx.audio?.play('windup');
        },
      },
      {
        slot: 'F', name: 'Shockwave', cooldown: 9, chargeable: true,
        desc: 'Punch out a concussive wave that flies mid-range and smashes through everything in its path. Charge for a bigger, harder wave.',
        execute(ctx) {
          const p = ctx.chargePower || 0;
          ctx.stallIfAirborne(0.4);
          ctx.viewmodel.trigger('heavy');
          const dir = ctx.aimDir();
          ctx.projectiles.spawn({
            pos: ctx.muzzle(), vel: dir.multiplyScalar(52),
            damage: 26 * (1 + 0.7 * p), color: 0xffaa55, coreColor: 0xfff2cc,
            size: 1.1 + 0.6 * p, radius: 1.2 + 0.5 * p,
            knockback: 15 + 8 * p, pierce: true, life: 0.65, gravity: 0,
            trailEvery: 0.01,
          });
          ctx.effects.ring(ctx.muzzle(), { color: 0xffaa55, endRadius: 2 + p, life: 0.25, axis: 'x', thickness: 0.35 });
          ctx.shake(0.25 + 0.15 * p);
          ctx.audio?.play('slam');
        },
      },
    ],
  },

  // ========================================================== STORM REAVER ==
  // Pure speed skirmisher: no bar, no gating, flat damage on everything.
  // Four dashes, and every ability is another way to move. Constant motion,
  // launches, and dragging enemies around the sky.
  reaver: {
    id: 'reaver',
    name: 'Storm Reaver',
    role: 'Speed skirmisher',
    tagline: 'Nothing in the sky is faster than you.',
    playstyle: 'Four dashes and every ability moves you. Storm Lunge spears a line straight through anyone in your way, Thunderclap cracks the air around you on demand, Cyclone launches you and everything nearby into the sky together, and Slipstream lets you fly free — anyone you touch gets dragged along and shredded for it. Never stop moving.',
    color: 0x55ddff,
    stats: { maxHealth: 90, walkSpeed: 12.5, maxDashes: 4, dashSpeed: 43, gravityScale: 0.78 },
    update(ctx, dt, state) {
      const p = ctx.player;
      // --- storm lunge: spear-first dash that skewers everything in the path ---
      if (state.lungeT > 0) {
        state.lungeT -= dt;
        p.vel.copy(state.lungeDir).multiplyScalar(state.lungeSpeed);
        p.stallTimer = 0;
        const tip = _v1.copy(p.position).addScaledVector(state.lungeDir, 1.8); tip.y += 1.1;
        for (const e of ctx.sphereHit(tip, 3.4)) {
          if (state.lungeHit.has(e)) continue;
          state.lungeHit.add(e);
          ctx.dealDamage(e, state.lungeDmg || 18, {
            knockback: _v2.copy(state.lungeDir).multiplyScalar(8).setY(4),
          });
          ctx.effects.impactBurst(e.center(new THREE.Vector3()), { color: 0x88eeff, size: 2 });
          ctx.game.hitstop(0.04);
          ctx.audio?.play('zap');
        }
        ctx.effects.glow(tip, { color: 0x66eaff, size: 1.2, life: 0.12 });
        // lunge ends with the speed kept — that's the whole economy
      }
      // --- slipstream: free flight that drags anyone you touch along with you ---
      if (state.flyT > 0) {
        state.flyT -= dt;
        const wish = p.wishDir(false);           // camera-relative, includes pitch
        const dir = wish || p.forwardDir(true);
        p.vel.copy(dir).multiplyScalar(state.flySpeed);
        p.stallTimer = 0;
        if (Math.random() < dt * 20) {
          ctx.effects.glow(p.position.clone().add(_v1.set(0, 1, 0)), { color: 0x88eeff, size: 1.0, life: 0.18 });
        }
        if (Math.random() < dt * 8) ctx.effects.dashStreaks(ctx.camera);
        // drag field: tick damage + drag on anything close enough to touch
        state.dragTick = (state.dragTick ?? 0) - dt;
        if (state.dragTick <= 0) {
          state.dragTick = 0.15;
          const center = p.position.clone(); center.y += 1;
          for (const e of ctx.sphereHit(center, state.dragR || 4.5)) {
            const kb = p.vel.clone().multiplyScalar(0.45); kb.y += 1.5;
            ctx.dealDamage(e, 3.5, { knockback: kb });
            ctx.effects.glow(e.center(new THREE.Vector3()), { color: 0xaaf2ff, size: 0.5, life: 0.2 });
          }
        }
      }
      // --- speed trail: pure velocity, no bar to scale off ---
      const spd = p.vel.length();
      if (spd > 18) {
        state.trailTick = (state.trailTick ?? 0) - dt;
        if (state.trailTick <= 0) {
          state.trailTick = 0.05;
          const back = p.position.clone().addScaledVector(p.vel, -0.04);
          back.y += 0.9 + Math.random() * 0.6;
          ctx.effects.glow(back, { color: 0x55aacc, size: 0.7, life: 0.22 });
        }
      }
    },
    basic: {
      name: 'Skypiercer',
      desc: 'A spear thrust in front of you. Flat damage, fast recovery — the attack you throw between dashes.',
      cooldown: 0.28,
      execute(ctx, state) {
        ctx.viewmodel.trigger('punch');   // no air-stall: never kill your own speed
        const p = ctx.player;
        const hits = ctx.meleeHit(5.5, 3.6);
        const fwd = p.forwardDir(true);
        for (const e of hits) {
          ctx.dealDamage(e, 10, { knockback: _v1.copy(fwd).multiplyScalar(8).setY(2.5) });
          const c = e.center(new THREE.Vector3());
          ctx.effects.burst(c, { count: 8, color: 0x88eeff, speed: 6, size: 0.2, life: 0.25 });
          ctx.effects.impactBurst(c, { color: 0x88eeff, size: 1.8 });
        }
        if (hits.length) ctx.audio?.play('slash');
        else ctx.audio?.play('whoosh');
      },
    },
    abilities: [
      {
        slot: 'Q', name: 'Storm Lunge', cooldown: 3.5, chargeable: true,
        desc: 'Spear-first dash that skewers everything in your path. Charged: faster, farther, and it hits harder. Leaves you quicker than it found you.',
        execute(ctx, state) {
          const cp = ctx.chargePower || 0;
          const p = ctx.player;
          state.lungeSpeed = Math.min(78, Math.max(42 + 14 * cp, p.vel.length() * 1.1 + 8 + 14 * cp));
          state.lungeT = 0.34 + 0.14 * cp;
          state.lungeDmg = 18 + 12 * cp;
          state.lungeDir = ctx.aimDir();
          state.lungeHit = new Set();
          p.dashTimer = 0;   // the lunge owns velocity now
          p.grounded = false;
          p.invulnTimer = Math.max(p.invulnTimer, 0.25);
          ctx.viewmodel.trigger('heavy');
          ctx.effects.dashStreaks(ctx.camera);
          ctx.audio?.play('dash');
        },
      },
      {
        slot: 'E', name: 'Thunderclap', cooldown: 6, chargeable: true,
        desc: 'Lightning cracks around you, stunning everything it touches for a beat. Charged: wider, harder, longer stun.',
        execute(ctx, state) {
          const cp = ctx.chargePower || 0;
          const p = ctx.player;
          const R = 12 + 4 * cp;
          const c = p.position.clone(); c.y += 1;
          const source = c.clone(); source.y += 3;
          for (const e of ctx.sphereHit(c, R)) {
            ctx.dealDamage(e, 7 + 6 * cp, { knockback: _v1.set(0, 2 + 2 * cp, 0), freeze: 0.9 + 0.5 * cp });
            const tp = e.center(new THREE.Vector3());
            ctx.effects.beam(source, tp, { color: 0xaaf2ff, radius: 0.1, life: 0.16 });
            ctx.effects.impactBurst(tp, { color: 0xaaf2ff, size: 1.6 + cp * 0.8 });
          }
          ctx.effects.ring(c, { color: 0xaaf2ff, endRadius: R, life: 0.3, thickness: 0.15 + cp * 0.1 });
          ctx.shake(0.2 + cp * 0.15);
          ctx.audio?.play('zap');
        },
      },
      {
        slot: 'R', name: 'Cyclone', cooldown: 7, chargeable: true,
        desc: 'A whirlwind that hurls you — and everyone near you — into the sky. Charged: a bigger storm that throws everyone higher.',
        execute(ctx, state) {
          const cp = ctx.chargePower || 0;
          const p = ctx.player;
          const R = 8.5 + 2.5 * cp;
          p.dashTimer = 0;   // a live dash rewrites velocity every frame and would eat the launch
          p.vel.y = Math.max(p.vel.y, 34 + 8 * cp);
          p.grounded = false;
          p.stallTimer = 0;
          const c = p.position.clone(); c.y += 1;
          for (const e of ctx.sphereHit(c, R)) {
            ctx.dealDamage(e, 20 + 12 * cp, { knockback: _v1.set(0, 30 + 8 * cp, 0) });
          }
          ctx.effects.ring(c, { color: 0x88eeff, endRadius: R, life: 0.4, thickness: 0.5 });
          ctx.effects.ring(c.clone().add(_v1.set(0, 1.5, 0)), { color: 0xaaf2ff, endRadius: R * 0.76, life: 0.45, thickness: 0.4 });
          ctx.effects.burst(c, { count: 34 + Math.floor(cp * 14), color: 0xaaf2ff, speed: 10 + cp * 4, size: 0.28, life: 0.5, gravity: -6 });
          ctx.audio?.play('whoosh');
        },
      },
      {
        slot: 'F', name: 'Slipstream', cooldown: 9, chargeable: true,
        desc: 'Free flight — steer with WASD. Anyone you touch gets dragged along for the ride and shredded lightly. Charged: longer, faster flight with a wider wake.',
        execute(ctx, state) {
          const cp = ctx.chargePower || 0;
          const p = ctx.player;
          state.flyT = 1.6 + 0.9 * cp;
          state.flySpeed = Math.max(p.vel.length() * 1.1, 26 + 10 * cp);
          state.dragR = 4.5 + 1.2 * cp;
          state.dragTick = 0;
          p.dashTimer = 0;   // don't fight a live dash for velocity control
          p.grounded = false;
          p.stallTimer = 0;
          ctx.effects.ring(p.position.clone().add(_v1.set(0, 1, 0)), { color: 0x88eeff, endRadius: 3, life: 0.4, axis: 'x' });
          ctx.effects.burst(p.position.clone().add(_v1.set(0, 1, 0)), {
            count: 20, color: 0xaaf2ff, speed: 7, size: 0.24, life: 0.4,
          });
          ctx.audio?.play('buff');
        },
      },
    ],
  },

  // ============================================================ SORCERER ==
  // Limitless kit: Red knocks away, Blue pulls in, both together make Purple.
  sorcerer: {
    id: 'sorcerer',
    name: 'Sorcerer',
    role: 'Limitless duelist',
    tagline: 'Throughout heaven and earth, you alone are the honored one.',
    playstyle: 'Control space with cursed energy. Red snipes at any range, Blue drags enemies into its core and holds them helpless, Black Flash detonates point-blank, and when you have three free seconds — Purple erases whatever it touches.',
    color: 0x8f5bff,
    stats: { maxHealth: 100, walkSpeed: 12, maxDashes: 3, dashSpeed: 41 },
    update(ctx, dt, state) {
      const p = ctx.player;

      // ---- BLUE: drifting singularity that drags everything into its core ----
      if (state.blue) {
        const B = state.blue;
        B.t -= dt;
        // drifts forward at constant speed for its whole lifetime
        B.pos.addScaledVector(B.vel, dt);
        B.mesh.position.copy(B.pos);
        B.mesh.rotation.y += dt * 1.6;
        const pulse = 1 + Math.sin(ctx.game.simTime * 6) * 0.06;
        B.mesh.scale.setScalar(pulse);
        // swirling intake: sparks spiral in from the rim
        if (Math.random() < dt * 30) {
          const a = Math.random() * Math.PI * 2;
          const rr = B.r * (0.5 + Math.random() * 0.5);
          ctx.effects.glow(_v1.set(B.pos.x + Math.cos(a) * rr, B.pos.y + (Math.random() - 0.5) * 2.5, B.pos.z + Math.sin(a) * rr).clone(), {
            color: 0x66aaff, size: 0.5, life: 0.3, grow: -1.2,
          });
        }
        // suction ticks: yank outer targets in, hold + crush inner ones
        B.tick -= dt;
        if (B.tick <= 0) {
          B.tick = 0.22;
          for (const e of ctx.sphereHit(B.pos, B.r)) {
            const c = e.center(new THREE.Vector3());
            const d = c.distanceTo(B.pos);
            if (d < 3) {
              // trapped at the core: held (no dashing out), lightly crushed
              const kb = _v1.copy(B.pos).sub(c).normalize().multiplyScalar(3);
              ctx.dealDamage(e, 2.5, { freeze: 0.5, knockback: kb });
              ctx.effects.glow(c, { color: 0x99ccff, size: 0.9, life: 0.2 });
            } else {
              // being pulled: reeled toward the core
              const kb = _v1.copy(B.pos).sub(c).normalize().multiplyScalar(Math.min(11 + d * 2.2, 28));
              kb.y += 2;
              ctx.dealDamage(e, 1.5, { knockback: kb });
              // pull streaks along the suction line so the drag reads
              ctx.effects.glow(c.clone().lerp(B.pos, 0.33), { color: 0x5599ff, size: 0.45, life: 0.18 });
              ctx.effects.glow(c.clone().lerp(B.pos, 0.66), { color: 0x5599ff, size: 0.45, life: 0.18 });
            }
          }
        }
        if (B.t <= 0 || !p.alive) {
          ctx.effects.ring(B.pos.clone(), { color: 0x4488ff, endRadius: B.r, life: 0.45, thickness: 0.4 });
          ctx.effects.burst(B.pos.clone(), { count: 30, color: 0x88bbff, color2: 0x3355dd, speed: 12, size: 0.3, life: 0.5, gravity: 0 });
          ctx.game.scene.remove(B.mesh);
          B.mesh.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
          });
          state.blue = null;
          ctx.audio?.play('explosion');
        }
      }

      // ---- PURPLE: 3s rooted channel, then the nuke flies ----
      if (state.nuke) {
        const N = state.nuke;
        N.t -= dt;
        p.damageTakenMult = 1.5;               // committed: you eat extra damage
        p.root(0.2);                            // refreshed: no move/dash/jump
        ctx.game.combat.lockT = Math.max(ctx.game.combat.lockT || 0, 0.2);  // no other casts
        const k = 1 - Math.max(0, N.t) / 3;     // 0 -> 1 over the channel
        // the orb hangs in front of your aim and swells
        const dir = ctx.aimDir();
        const orbPos = _v1.copy(p.eyePosition).addScaledVector(dir, 2.6 + k * 1.6);
        N.mesh.position.copy(orbPos);
        N.mesh.scale.setScalar(0.25 + k * 2.3);
        N.mesh.rotation.y += dt * 3;
        N.light.intensity = 2 + k * 10;
        // red + blue sparks converging into purple
        if (Math.random() < dt * 40) {
          const off = _v2.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5);
          ctx.effects.glow(orbPos.clone().add(off), {
            color: Math.random() < 0.5 ? 0xff2244 : 0x3366ff, size: 0.3 + k * 0.4, life: 0.22, grow: -1.5,
          });
        }
        ctx.shake(k * 0.04);
        if (N.t <= 0 && p.alive) {
          // FIRE.
          const firePos = orbPos.clone();
          ctx.game.scene.remove(N.mesh);
          N.disposeMesh();
          state.nuke = null;
          ctx.viewmodel.trigger('heavy');
          ctx.projectiles.spawn({
            pos: firePos, vel: dir.clone().multiplyScalar(80),
            damage: 95, aoe: 10, aoeDamage: 60, color: 0xa64dff, coreColor: 0xf0e0ff,
            size: 2.6, radius: 2.6, knockback: 26, life: 0.9, gravity: 0,
            trailEvery: 0.006, explodeOnExpire: true,
            onImpact: (pos) => {
              ctx.shake(0.7);
              ctx.game.hitstop(0.12);
              ctx.game.hud?.flash('rgba(166, 77, 255, 0.22)', 0.35);
              ctx.effects.impactBurst(pos, { color: 0xcc88ff, size: 8 });
              ctx.effects.ring(pos, { color: 0xa64dff, endRadius: 10, life: 0.5, thickness: 0.6 });
              ctx.audio?.play('meteorHit');
            },
          });
          ctx.effects.ring(firePos, { color: 0xa64dff, endRadius: 4, life: 0.3, axis: 'x', thickness: 0.4 });
          ctx.game.hud?.flash('rgba(166, 77, 255, 0.12)', 0.2);
          ctx.shake(0.4);
          ctx.audio?.play('explosion');
        } else if (!p.alive && state.nuke) {
          // died mid-channel: fizzle
          ctx.game.scene.remove(N.mesh);
          N.disposeMesh();
          state.nuke = null;
        }
      } else {
        p.damageTakenMult = 1;
      }
    },
    basic: {
      name: 'Cursed Fists',
      desc: 'Fast bare-knuckle strikes laced with cursed energy.',
      cooldown: 0.3,
      execute(ctx) {
        ctx.stallIfAirborne(0.3);
        ctx.viewmodel.trigger('punch');
        const hits = ctx.meleeHit(3.6, 3.2);
        const fwd = ctx.player.forwardDir(true);
        for (const e of hits) {
          ctx.dealDamage(e, 14, { knockback: _v1.copy(fwd).multiplyScalar(7).setY(3.5) });
          ctx.effects.burst(e.position.clone().setY(e.position.y + e.height * 0.6), {
            count: 9, color: 0xc9a8ff, speed: 6, size: 0.2, life: 0.28,
          });
        }
        if (hits.length) { ctx.shake(0.11); ctx.game.hitstop(0.025); ctx.audio?.play('punchHit'); }
        else ctx.audio?.play('whoosh');
      },
    },
    abilities: [
      {
        slot: 'Q', name: 'Red', cooldown: 4, chargeable: true,
        desc: 'Repulsive force fired as a blazing red bolt — so fast it snipes across the whole arena. Charge for a heavier blast.',
        execute(ctx) {
          const p = ctx.chargePower || 0;
          ctx.slowFallIfAirborne(0.5);
          ctx.viewmodel.trigger('heavy');
          const dir = ctx.aimDir();
          ctx.projectiles.spawn({
            pos: ctx.muzzle(), vel: dir.multiplyScalar(110),
            damage: 24 * (1 + 0.6 * p), aoe: 2.2 + p, aoeDamage: 12,
            color: 0xff2244, coreColor: 0xffffff, size: 0.55 + 0.2 * p, radius: 0.65 + 0.25 * p,
            knockback: 15 + 6 * p, life: 1.5, gravity: 0, trailEvery: 0.005,
          });
          ctx.effects.ring(ctx.muzzle(), { color: 0xff2244, endRadius: 1.6 + p, life: 0.22, axis: 'x', thickness: 0.3 });
          ctx.effects.glow(ctx.muzzle(), { color: 0xff5566, size: 1.1, life: 0.15 });
          ctx.shake(0.2 + 0.15 * p);
          ctx.audio?.play('beam');
        },
      },
      {
        slot: 'E', name: 'Blue', cooldown: 12, chargeable: true,
        desc: 'Attractive force: a huge drifting orb that drags everyone nearby into its core and holds them there — no dashing out. Charge for a wider, longer pull.',
        execute(ctx, state) {
          if (state.blue) return false;   // one singularity at a time
          const p = ctx.chargePower || 0;
          const dir = ctx.aimDir();
          const mesh = buildBlueOrb();
          const pos = ctx.muzzle().addScaledVector(dir, 2.5);
          mesh.position.copy(pos);
          ctx.game.scene.add(mesh);
          state.blue = {
            pos, vel: dir.multiplyScalar(14),
            t: 3.5 + 1.5 * p, r: 8 + 2.5 * p, tick: 0, mesh,
          };
          const rr = state.blue.r;
          mesh.getObjectByName('pullRadius').scale.setScalar(rr);
          mesh.getObjectByName('pullRadiusEdge').scale.setScalar(rr);
          ctx.viewmodel.trigger('cast');
          ctx.effects.ring(pos.clone(), { color: 0x4488ff, endRadius: 3, life: 0.3, axis: 'x', thickness: 0.3 });
          ctx.audio?.play('charge');
        },
      },
      {
        slot: 'R', name: 'Purple Nuke', cooldown: 18,
        desc: 'Imaginary mass. Root yourself for 3 seconds — unable to move, dash or cast, taking 1.5x damage — while a colossal purple orb swells. Then it erases everything in its path.',
        canStart: (state) => !state.nuke,
        execute(ctx, state) {
          if (state.nuke) return false;
          const p = ctx.player;
          const mesh = buildPurpleOrb();
          const light = mesh.getObjectByName('nukeLight');
          ctx.game.scene.add(mesh);
          state.nuke = {
            t: 3, mesh, light,
            disposeMesh: () => mesh.traverse((o) => {
              if (o.geometry) o.geometry.dispose();
              if (o.material) o.material.dispose();
            }),
          };
          p.root(3.1);
          ctx.game.combat.lockT = 3.05;
          ctx.viewmodel.trigger('heavy');
          ctx.effects.ring(p.position.clone().add(_v1.set(0, 1.2, 0)), { color: 0xa64dff, endRadius: 3, life: 0.4, axis: 'x', thickness: 0.3 });
          ctx.audio?.play('windup');
        },
      },
      {
        slot: 'F', name: 'Black Flash', cooldown: 7, chargeable: true,
        desc: 'Cursed energy detonates on impact: a crackling close-range blast of red, black and white lightning that hurls enemies away. Charge to reach farther and hit harder.',
        execute(ctx) {
          const p = ctx.chargePower || 0;
          ctx.viewmodel.trigger('punch');
          const dir = ctx.aimDir();
          const hits = ctx.coneHit(6.4 + p * 1.8, 85);
          for (const e of hits) {
            const kb = _v1.copy(dir).multiplyScalar(18 + 9 * p);
            kb.y += 4 + 2 * p;
            ctx.dealDamage(e, 18 * (1 + 0.5 * p), { knockback: kb });
            // red/white lightning arcs onto the victim: jagged 3-segment bolt
            const c = e.center(new THREE.Vector3());
            let prev = ctx.muzzle();
            for (let i = 0; i < 3; i++) {
              const pt = i === 2 ? c : prev.clone().lerp(c, 0.5).add(new THREE.Vector3(
                (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6
              ));
              ctx.effects.beam(prev, pt, { color: i === 1 ? 0xffffff : 0xff2233, radius: 0.07, life: 0.16 });
              prev = pt;
            }
            ctx.effects.impactBurst(c, { color: 0xff3344, size: 2.6 });
            // black crackle: non-additive near-black shards
            ctx.effects.burst(c, { count: 12, color: 0x15151a, color2: 0x2a0a12, speed: 9, size: 0.3, life: 0.35, additive: false });
            ctx.effects.burst(c, { count: 10, color: 0xffffff, color2: 0xff2233, speed: 11, size: 0.22, life: 0.3 });
          }
          const front = ctx.player.eyePosition.clone().addScaledVector(dir, 2.8);
          ctx.effects.ring(front, { color: 0xff2233, endRadius: 4.5 + p * 1.5, life: 0.35, axis: 'x', thickness: 0.4 });
          if (hits.length) {
            ctx.game.hitstop(0.08);
            ctx.shake(0.35);
            ctx.audio?.play('zap');
            ctx.audio?.play('slam');
          } else {
            ctx.audio?.play('whoosh');
          }
        },
      },
    ],
  },

  // ============================================================ ASSASSIN ==
  assassin: {
    id: 'assassin',
    name: 'Shadow Assassin',
    role: 'Burst duelist',
    tagline: 'Strike hard, poison everything, retreat before they turn around.',
    playstyle: 'Fragile hit-and-run. Every attack seeps void poison that keeps eating after you leave. Shadowstep in, slice, and get pulled back out automatically; slow runners with Void Slash; and when you see an opening, Eviscerate — a dash-slice that flows into an uppercut carry and a final slash that hurls the victim away.',
    color: 0x9a5fff,
    stats: { maxHealth: 65, walkSpeed: 13, maxDashes: 4, dashSpeed: 44 },
    update(ctx, dt, state) {
      const p = ctx.player;
      // --- shadowstep: dash out, slice, dash back ---
      if (state.step) {
        const S = state.step;
        S.t -= dt;
        p.invulnTimer = Math.max(p.invulnTimer, 0.12);
        p.stallTimer = 0;
        if (S.phase === 'out') {
          p.vel.copy(S.dir).multiplyScalar(40);
          const blade = _v1.copy(p.position).addScaledVector(S.dir, 1.4); blade.y += 1.1;
          for (const e of ctx.sphereHit(blade, 2.6)) {
            if (S.hit.has(e)) continue;
            S.hit.add(e);
            ctx.dealDamage(e, 34 * (1 + 0.8 * S.pow), {
              knockback: _v2.copy(S.dir).multiplyScalar(4).setY(3),
              poison: voidPoison(1.5),
            });
            ctx.effects.impactBurst(e.center(new THREE.Vector3()), { color: 0xbb66ff, size: 2.4 });
            ctx.game.hitstop(0.05);
            ctx.audio?.play('slash');
          }
          if (Math.random() < dt * 30) {
            ctx.effects.glow(p.position.clone().add(_v2.set(0, 1, 0)), { color: 0x7744cc, size: 0.9, life: 0.15 });
          }
          if (S.t <= 0) {
            S.phase = 'back';
            S.t = 0.45;
            ctx.effects.burst(p.position.clone().add(_v2.set(0, 1, 0)), { count: 14, color: 0x7744cc, speed: 6, size: 0.22, life: 0.3 });
          }
        } else {
          // reel back to where you started
          _v1.copy(S.origin).sub(p.position);
          const d = _v1.length();
          if (d < 1.4 || S.t <= 0) {
            p.position.copy(S.origin);
            p.vel.multiplyScalar(0.2);
            state.step = null;
            ctx.effects.burst(p.position.clone().add(_v2.set(0, 1, 0)), { count: 18, color: 0xbb66ff, speed: 7, size: 0.24, life: 0.35 });
            ctx.audio?.play('blink');
          } else {
            p.vel.copy(_v1.normalize()).multiplyScalar(Math.max(42, d * 6));
          }
        }
      }
      // --- eviscerate: dash-slice → beat → uppercut carry → beat → launching slash ---
      // paced like a comic panel sequence: a readable breath between every hit,
      // and the victim is frozen + pinned to the combo from the moment it's caught
      if (state.evis && !p.alive) state.evis = null;   // death cancels the combo
      if (state.evis) {
        const E = state.evis;
        E.t -= dt;
        p.invulnTimer = Math.max(p.invulnTimer, 0.12);
        p.stallTimer = 0;
        if (E.target && !E.target.alive) E.target = null;   // died mid-combo
        // the victim rides the blade through the whole combo: pinned to a point
        // just ahead of the player (reeled onto it when first caught), so it is
        // dragged with the uppercut and thrown from wherever the combo ends
        const pin = (reel) => {
          const t = E.target;
          if (!t) return;
          _v1.copy(p.position).addScaledVector(E.dir, 2.1);
          _v1.y = p.position.y + 1.2;
          if (reel) t.position.lerp(_v1, 1 - Math.exp(-16 * dt));
          else t.position.copy(_v1);
          t.vel.set(0, 0, 0);
          t.frozen = Math.max(t.frozen, 0.2);
          t.aggro = true;
        };
        if (E.phase === 'dash') {
          p.vel.copy(E.dir).multiplyScalar(46);
          const blade = _v1.copy(p.position).addScaledVector(E.dir, 1.5); blade.y += 1.1;
          const hits = ctx.sphereHit(blade, 2.8);
          if (hits.length) {
            // opening slice cuts everyone in the arc; the closest carryable one
            // gets carried (shield-protected enemies and golems are too much to lift)
            const carryable = (e) => e.alive && e.type !== 'golem'
              && !(e.shieldedBy && e.shieldedBy.alive && e.shieldedBy !== e);
            let best = null, bd = Infinity;
            for (const e of hits) {
              ctx.dealDamage(e, 26, { poison: voidPoison(1.5) });
              const d = e.position.distanceToSquared(p.position);
              if (d < bd && carryable(e)) { bd = d; best = e; }
            }
            const fx = best || hits[0];
            ctx.effects.impactBurst(fx.center(new THREE.Vector3()), { color: 0xbb66ff, size: 2.2 });
            ctx.game.hitstop(0.05);
            ctx.audio?.play('slash');
            E.target = best;
            if (best) {
              E.phase = 'catch';   // beat one: reel them onto the blade
              E.t = 0.26;
            } else {
              state.evis = null;   // nothing worth carrying — the slice was it
            }
          } else if (E.t <= 0) {
            state.evis = null;   // whiffed — the dash was all you get
          }
        } else if (E.phase === 'catch') {
          p.vel.set(0, 1.2, 0);   // hang mid-air while they're dragged onto the blade
          pin(true);
          if (Math.random() < dt * 20 && E.target) {
            ctx.effects.glow(E.target.center(new THREE.Vector3()), { color: 0x7744cc, size: 0.7, life: 0.15 });
          }
          if (E.t <= 0) {
            E.phase = 'upper';
            E.t = 0.38;
            const t = E.target;
            if (t) {
              ctx.dealDamage(t, 30, { poison: voidPoison(1.5) });
              if (t.alive) ctx.effects.impactBurst(t.center(new THREE.Vector3()), { color: 0xbb66ff, size: 2 });
              ctx.game.hitstop(0.05);
            }
            ctx.viewmodel.trigger('punch');
            ctx.audio?.play('slash');
          }
        } else if (E.phase === 'upper') {
          // rise, the victim skewered just ahead of the blade
          p.vel.set(E.dir.x * 5, 16, E.dir.z * 5);
          if (E.target) {
            pin(false);
            if (Math.random() < dt * 25) {
              ctx.effects.glow(E.target.center(new THREE.Vector3()), { color: 0x7744cc, size: 0.8, life: 0.15 });
            }
          }
          if (E.t <= 0) {
            E.phase = 'apex';   // beat two: hang at the top, blade drawn back
            E.t = 0.26;
          }
        } else if (E.phase === 'apex') {
          p.vel.set(0, 0.6, 0);
          pin(false);
          if (E.t <= 0) {
            // final slash: launch them away hard
            const v = E.target;
            if (v) {
              ctx.dealDamage(v, 60, {
                knockback: _v2.set(E.dir.x, 0, E.dir.z).normalize().multiplyScalar(34).setY(7),
                poison: voidPoison(2),
              });
              ctx.effects.impactBurst(v.center(new THREE.Vector3()), { color: 0xff44aa, size: 3 });
              ctx.game.hitstop(0.09);
              ctx.game.hud?.flash('rgba(187, 102, 255, 0.12)', 0.22);
            }
            ctx.viewmodel.trigger('heavy');
            ctx.shake(0.3);
            ctx.audio?.play('eviscerate');
            p.vel.set(0, 0, 0);
            state.evis = null;
          }
        }
      }
      // --- focus targeting: the enemy near your crosshair is marked with a reticle ---
      if (!state.focusMesh) {
        state.focusMesh = buildFocusMesh();
        ctx.game.scene.add(state.focusMesh);
      }
      const focus = ctx.rayHits(ctx.player.eyePosition.clone(), ctx.aimDir(), 42, 5)[0] || null;
      state.focus = focus;
      if (focus) {
        state.focusMesh.visible = true;
        state.focusMesh.position.copy(focus.position);
        state.focusMesh.position.y += focus.height + 0.7;
        const pulse = 0.8 + Math.sin(ctx.game.simTime * 8) * 0.12;
        state.focusMesh.scale.setScalar(pulse);
        state.focusMesh.material.rotation += dt * 2;
      } else {
        state.focusMesh.visible = false;
      }
    },
    basic: {
      name: 'Twin Fangs',
      desc: 'Fast alternating dagger slashes laced with void poison. Double damage from behind.',
      cooldown: 0.26,
      execute(ctx) {
        ctx.stallIfAirborne(0.28);
        ctx.viewmodel.trigger('punch');
        const hits = ctx.meleeHit(3.4, 2.6);
        const fwd = ctx.player.forwardDir(true);
        let anyBehind = false;
        for (const e of hits) {
          const toPlayer = _v1.copy(ctx.player.position).sub(e.position).normalize();
          const behind = e.facing && toPlayer.dot(e.facing) < -0.25;
          if (behind) anyBehind = true;
          let dmg = 16;
          if (behind) dmg *= 2.2;
          ctx.dealDamage(e, dmg, { knockback: _v2.copy(fwd).multiplyScalar(5).setY(2.5), poison: voidPoison() });
          // every hit gets real feedback now — backstabs just hit harder
          ctx.effects.burst(e.position.clone().setY(e.position.y + e.height * 0.7), {
            count: behind ? 16 : 9, color: 0xbb66ff, speed: behind ? 8 : 6, size: behind ? 0.26 : 0.2, life: behind ? 0.4 : 0.28,
          });
        }
        if (hits.length) {
          ctx.game.hitstop(anyBehind ? 0.045 : 0.022);
          ctx.shake(anyBehind ? 0.18 : 0.09);
          ctx.audio?.play('slash');
        } else ctx.audio?.play('whoosh');
      },
    },
    abilities: [
      {
        slot: 'Q', name: 'Shadowstep', cooldown: 6, chargeable: true,
        canStart: (state) => !state.step && !state.evis,   // no doomed charges mid-trick
        desc: 'A long dash through the shadows — vicious poisoned slices on everything you pass — then snap back to where you started. Charge to dash even deeper.',
        execute(ctx, state) {
          const pow = ctx.chargePower || 0;
          if (state.step || state.evis) return false;   // already mid-shadow-trick
          const p = ctx.player;
          state.step = {
            phase: 'out', t: 0.3 + 0.12 * pow,   // rocket-charge range
            dir: ctx.aimDir(), origin: p.position.clone(),
            pow, hit: new Set(),
          };
          p.grounded = false;
          p.invulnTimer = Math.max(p.invulnTimer, 0.7);
          ctx.viewmodel.trigger('heavy');
          ctx.effects.burst(p.position.clone().add(_v1.set(0, 1, 0)), { count: 18, color: 0x7744cc, speed: 6, size: 0.24, life: 0.35 });
          ctx.effects.dashStreaks(ctx.camera);
          ctx.audio?.play('blink');
        },
      },
      {
        slot: 'E', name: 'Void Slash', cooldown: 7, chargeable: true,
        desc: 'Hurl a crescent of void that cuts through everyone in a line — the wound slows them and seeps poison. Charge for a wider, crueler slash.',
        execute(ctx) {
          const p = ctx.chargePower || 0;
          ctx.slowFallIfAirborne(0.5);
          ctx.viewmodel.trigger('cast');
          const dir = ctx.aimDir();
          ctx.projectiles.spawn({
            pos: ctx.muzzle(), vel: dir.multiplyScalar(68),
            damage: 14 * (1 + 0.7 * p), color: 0x9a5fff, coreColor: 0xe0ccff,
            size: 0.7 + 0.35 * p, radius: 0.8 + 0.4 * p,
            knockback: 5, pierce: true, life: 0.6, gravity: 0,
            slow: 2.5 + 1.5 * p, poison: voidPoison(),
            trailEvery: 0.01,
          });
          ctx.effects.ring(ctx.muzzle(), { color: 0x9a5fff, endRadius: 1.4, life: 0.22, axis: 'x', thickness: 0.25 });
          ctx.audio?.play('slash');
        },
      },
      {
        slot: 'R', name: 'Death Mark', cooldown: 9, chargeable: true,
        desc: 'Mark your focused target: +35% damage from everything, and void poison starts eating them immediately. Charged: the mark lasts longer.',
        execute(ctx, state) {
          const p = ctx.chargePower || 0;
          const target = state.focus || ctx.rayHits(ctx.muzzle(), ctx.aimDir(), 45, 4)[0];
          if (!target || !target.alive) return false;
          target.marked = 8 + 6 * p;
          ctx.dealDamage(target, 2, { poison: voidPoison(1.5) });
          ctx.effects.glow(target.position.clone().setY(target.position.y + target.height + 0.6), {
            color: 0xff44aa, size: 1.4, life: 0.8,
          });
          ctx.effects.impactBurst(target.center(new THREE.Vector3()), { color: 0xff44aa, size: 1.6 });
          ctx.game.hitstop(0.03);
          ctx.audio?.play('mark');
        },
      },
      {
        slot: 'F', name: 'Eviscerate', cooldown: 12,
        desc: 'A shadow combo: dash forward with a slice — if it lands, an uppercut drags the victim into the sky with you, and a final slash hurls them away. Brutal total damage.',
        execute(ctx, state) {
          if (state.evis || state.step) return false;   // one shadow-trick at a time
          const p = ctx.player;
          state.evis = { phase: 'dash', t: 0.26, dir: ctx.aimDir(), target: null };
          p.grounded = false;
          p.invulnTimer = Math.max(p.invulnTimer, 0.9);
          ctx.viewmodel.trigger('heavy');
          ctx.effects.dashStreaks(ctx.camera);
          ctx.audio?.play('blink');
        },
      },
    ],
  },
};

export const CLASS_LIST = ['mage', 'brawler', 'reaver', 'sorcerer', 'assassin'];
