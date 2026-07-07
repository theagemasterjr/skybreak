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

// ---- Storm Reaver momentum system ----
// A heat bar (0..1) that charges SLOWLY, and only while you're genuinely fast
// (dashes, lunges, dives). The moment you coast it bleeds out at a steady
// clip, and on the ground it empties almost instantly. The intended rhythm:
// build speed, spend the bar on a big hit, get forced low, build again.
// All reaver damage multiplies by reaverMul(bar): 0.15x empty .. 5x full.
export function reaverMul(momentum) {
  return 0.15 + 4.85 * (momentum || 0);
}
export function updateMomentum(player, state, dt) {
  let m = state.momentum || 0;
  const spd = player.vel.length();
  // only EARNED speed feeds the bar: dashes, Storm Lunge, Galvanize, Cyclone
  // and Slipstream open a short charging window (moves that carry speed keep
  // it open by chaining). Plain WASD flying or falling never charges it.
  const activeMove = (state.lungeT || 0) > 0 || (state.flyT || 0) > 0 || player.dashTimer > 0;
  if (activeMove) state.earnedT = 1.1;
  else state.earnedT = Math.max(0, (state.earnedT || 0) - dt);
  if (player.grounded && !activeMove) {
    m -= dt * 0.65;                                  // floor is lava: empty in ~1.5s
  } else if (spd > 17 && state.earnedT > 0) {
    // charging takes real speed, and the top of the bar fills slower than
    // the bottom — max power is earned through dash chains, not idled into
    const k = Math.min(1, (spd - 17) / 30);
    m += dt * 0.26 * k * (1 - 0.5 * m);
  } else {
    m -= dt * 0.24;                                  // coasting: drains out in ~4s
  }
  state.momentum = Math.min(1, Math.max(0, m));
  return state.momentum;
}

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
          const fwd = p.forwardDir(false);
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
        const fwd = ctx.player.forwardDir(false);
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
            pos: ctx.muzzle(), vel: dir.multiplyScalar(34),
            damage: 26 * (1 + 0.7 * p), color: 0xffaa55, coreColor: 0xfff2cc,
            size: 1.1 + 0.6 * p, radius: 1.2 + 0.5 * p,
            knockback: 15 + 8 * p, pierce: true, life: 0.8, gravity: 0,
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
  // Momentum spearfighter: every hit scales with how fast you're moving.
  // Near-zero damage standing still, brutal at full speed. Keep moving.
  reaver: {
    id: 'reaver',
    name: 'Storm Reaver',
    role: 'Momentum spearfighter',
    tagline: 'Speed is the weapon. Build it, keep it, spend it.',
    playstyle: 'Damage scales with your MOMENTUM bar, and only EARNED speed feeds it: dashes, Storm Lunge, Galvanize, Cyclone and Slipstream charge the bar — plain flying or falling never does. It drains the moment you coast, faster still on the ground. Build the bar with moves, spend it on a spear hit at up to 5× power, then build it again. You also fall a little slower than everyone else.',
    color: 0x55ddff,
    stats: { maxHealth: 90, walkSpeed: 12.5, maxDashes: 4, dashSpeed: 43, gravityScale: 0.78 },
    speedMeter: true,   // HUD shows the momentum bar
    update(ctx, dt, state) {
      const p = ctx.player;
      const momentum = updateMomentum(p, state, dt);
      // --- storm lunge: spear-first dash that skewers everything in the path ---
      if (state.lungeT > 0) {
        state.lungeT -= dt;
        p.vel.copy(state.lungeDir).multiplyScalar(state.lungeSpeed);
        p.stallTimer = 0;
        const tip = _v1.copy(p.position).addScaledVector(state.lungeDir, 1.8); tip.y += 1.1;
        for (const e of ctx.sphereHit(tip, 3.4)) {
          if (state.lungeHit.has(e)) continue;
          state.lungeHit.add(e);
          const mul = reaverMul(state.momentum);
          ctx.dealDamage(e, 16 * mul, {
            knockback: _v2.copy(state.lungeDir).multiplyScalar(8).setY(4),
          });
          ctx.effects.impactBurst(e.center(new THREE.Vector3()), { color: 0x88eeff, size: 1.6 + mul * 0.7 });
          if (mul > 1.4) ctx.game.hitstop(0.04);
          ctx.audio?.play('zap');
        }
        ctx.effects.glow(tip, { color: 0x66eaff, size: 1.2, life: 0.12 });
        // lunge ends with the speed kept — that's the whole economy
      }
      // --- slipstream: brief free flight, speed preserved through turns ---
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
      }
      // --- momentum visuals: crackle and streak as the bar fills ---
      const spd = p.vel.length();
      if (spd > 18 || momentum > 0.4) {
        state.trailTick = (state.trailTick ?? 0) - dt;
        if (state.trailTick <= 0) {
          state.trailTick = 0.05;
          const back = p.position.clone().addScaledVector(p.vel, -0.04);
          back.y += 0.9 + Math.random() * 0.6;
          ctx.effects.glow(back, { color: momentum > 0.7 ? 0xaaf2ff : 0x55aacc, size: 0.4 + momentum * 0.9, life: 0.22 });
        }
        if (momentum > 0.7 && Math.random() < dt * 6) ctx.effects.dashStreaks(ctx.camera);
      }
    },
    basic: {
      name: 'Skypiercer',
      desc: 'A spear thrust in front of you. Damage scales with your momentum bar — empty it tickles, full it impales at 5× power.',
      cooldown: 0.28,
      execute(ctx, state) {
        ctx.viewmodel.trigger('punch');   // no air-stall: never kill your own momentum
        const p = ctx.player;
        const mul = reaverMul(state.momentum);
        const hits = ctx.meleeHit(5.5, 3.6);
        const fwd = p.forwardDir(false);
        for (const e of hits) {
          ctx.dealDamage(e, 9 * mul, { knockback: _v1.copy(fwd).multiplyScalar(5 + 3 * mul).setY(2.5) });
          if (mul > 1.4) {
            ctx.effects.impactBurst(e.center(new THREE.Vector3()), { color: 0x88eeff, size: 1.8 });
          } else {
            ctx.effects.burst(e.center(new THREE.Vector3()), { count: 8, color: 0x88eeff, speed: 6, size: 0.2, life: 0.25 });
          }
        }
        if (hits.length) {
          ctx.audio?.play('slash');
          if (mul > 1.4) { ctx.game.hitstop(0.035); ctx.shake(0.12); }
        } else ctx.audio?.play('whoosh');
      },
    },
    abilities: [
      {
        slot: 'Q', name: 'Storm Lunge', cooldown: 3.5,
        desc: 'Lunge spear-first along your aim, skewering everything near your path. Damage scales with your momentum bar, and the lunge leaves you faster than it found you.',
        execute(ctx, state) {
          const p = ctx.player;
          // entering fast lunges faster — momentum compounds
          state.lungeSpeed = Math.min(64, Math.max(42, p.vel.length() * 1.1 + 8));
          state.lungeT = 0.34;
          state.lungeDir = ctx.aimDir();
          state.lungeHit = new Set();
          p.grounded = false;
          p.invulnTimer = Math.max(p.invulnTimer, 0.25);
          ctx.viewmodel.trigger('heavy');
          ctx.effects.dashStreaks(ctx.camera);
          ctx.audio?.play('dash');
        },
      },
      {
        slot: 'E', name: 'Galvanize', cooldown: 6,
        desc: 'A jolt of lightning MULTIPLIES your current speed, pops you upward, and bursts around you for light damage. The faster you already are, the more it gives.',
        execute(ctx, state) {
          const p = ctx.player;
          state.earnedT = 1.4;   // ability speed counts toward the bar
          // multiplier: scales what you have (with a floor so it works from a standstill)
          const s = p.vel.length();
          if (s > 4) {
            p.vel.multiplyScalar(1.35);
          } else {
            p.vel.addScaledVector(p.forwardDir(true), 10);
          }
          p.vel.y += 6;                    // a little hop
          p.grounded = false;
          p.stallTimer = 0;
          // small lightning burst
          const c = p.position.clone(); c.y += 1.1;
          for (const e of ctx.sphereHit(c, 6)) {
            ctx.dealDamage(e, 8, { knockback: _v2.set(0, 4, 0) });
            const tp = e.center(new THREE.Vector3());
            ctx.effects.beam(c, tp, { color: 0x88eeff, radius: 0.08, life: 0.18 });
          }
          ctx.effects.ring(c, { color: 0x88eeff, endRadius: 6, life: 0.35, thickness: 0.3 });
          ctx.effects.burst(c, { count: 14, color: 0xaaf2ff, speed: 8, size: 0.22, life: 0.3 });
          ctx.audio?.play('zap');
        },
      },
      {
        slot: 'R', name: 'Cyclone', cooldown: 7,
        desc: 'A whirlwind hurls you high into the sky — your horizontal momentum is untouched. Enemies caught in it are dragged up with you.',
        execute(ctx, state) {
          const p = ctx.player;
          state.earnedT = 1.2;   // ability speed counts toward the bar
          p.vel.y = Math.max(p.vel.y, 28);   // high up, x/z momentum kept
          p.grounded = false;
          p.stallTimer = 0;
          const c = p.position.clone(); c.y += 1;
          const mul = reaverMul(state.momentum);
          for (const e of ctx.sphereHit(c, 5.5)) {
            ctx.dealDamage(e, 10 * mul, { knockback: _v1.set(0, 18, 0) });
          }
          ctx.effects.ring(c, { color: 0x88eeff, endRadius: 5.5, life: 0.4, thickness: 0.4 });
          ctx.effects.ring(c.clone().add(_v1.set(0, 1.5, 0)), { color: 0xaaf2ff, endRadius: 4, life: 0.45, thickness: 0.3 });
          ctx.effects.burst(c, { count: 26, color: 0xaaf2ff, speed: 9, size: 0.26, life: 0.45, gravity: -6 });
          ctx.audio?.play('whoosh');
        },
      },
      {
        slot: 'F', name: 'Slipstream', cooldown: 9,
        desc: 'Free flight for a moment: steer with WASD and your speed is fully preserved through every direction change.',
        execute(ctx, state) {
          const p = ctx.player;
          state.flyT = 1.6;
          state.flySpeed = Math.max(p.vel.length(), 20);
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

  // ============================================================== WARDEN ==
  warden: {
    id: 'warden',
    name: 'Warden',
    role: 'Bulwark knight',
    tagline: 'Highest health in the game. Pull them in. Outlast them all.',
    playstyle: 'The immovable anchor. Drag enemies to you with Chain Pull, hurl them off the island with Aegis Bash, taunt everything with Battle Roar and heal inside your Bulwark Dome. You win by refusing to die.',
    color: 0xffd76a,
    stats: { maxHealth: 170, walkSpeed: 10.5, maxDashes: 2, dashSpeed: 36 },
    update(ctx, dt, state) {
      const p = ctx.player;
      if (state.blockT > 0) {
        state.blockT -= dt;
        p.damageReduction = 0.65;
        if (ctx.viewmodel.rig.shield) {
          ctx.viewmodel.rig.shield.position.lerp(_v1.set(-0.12, 0, -0.42), Math.min(1, dt * 12));
        }
      } else {
        if (state.drT > 0) { state.drT -= dt; p.damageReduction = 0.3; }
        else p.damageReduction = 0;
        if (ctx.viewmodel.rig.shield) {
          ctx.viewmodel.rig.shield.position.lerp(_v1.set(-0.55, 0.02, -0.1), Math.min(1, dt * 8));
        }
      }
    },
    basic: {
      name: 'Cleave',
      desc: 'A wide sword swing that hits everything in front of you.',
      cooldown: 0.38,
      execute(ctx) {
        ctx.stallIfAirborne(0.32);
        ctx.viewmodel.trigger('punch');
        const hits = ctx.meleeHit(4.0, 3.6);
        const fwd = ctx.player.forwardDir(false);
        for (const e of hits) {
          ctx.dealDamage(e, 16, { knockback: _v1.copy(fwd).multiplyScalar(7).setY(3.5) });
        }
        if (hits.length) { ctx.shake(0.1); ctx.game.hitstop(0.03); ctx.audio?.play('slash'); }
        else ctx.audio?.play('whoosh');
      },
    },
    abilities: [
      {
        slot: 'Q', name: 'Aegis Bash', cooldown: 7, chargeable: true,
        desc: 'Slam your shield forward: enemies in front are hurled away. Great near edges.',
        execute(ctx, state) {
          const p = ctx.chargePower || 0;
          ctx.viewmodel.trigger('punch');
          state.blockT = 0.6;   // brief guard during the bash
          const dir = ctx.aimDir(); dir.y = Math.max(dir.y, 0);
          const hits = ctx.coneHit(4.6 + p * 1.6, 85);
          for (const e of hits) {
            const kb = _v1.copy(dir).setY(0).normalize().multiplyScalar(17 + 9 * p);
            kb.y = 5 + 3 * p;
            ctx.dealDamage(e, 12 * (1 + 0.5 * p), { knockback: kb });
          }
          const front = ctx.player.position.clone().addScaledVector(ctx.player.forwardDir(false), 2.5);
          front.y += 1.2;
          ctx.effects.ring(front, { color: 0xffd76a, endRadius: 4 + p * 1.5, life: 0.35, axis: 'x', thickness: 0.4 });
          if (hits.length) {
            ctx.effects.impactBurst(front, { color: 0xffe9a8, size: 3 });
            ctx.game.hitstop(0.06);
            ctx.shake(0.25);
            ctx.audio?.play('slam');
          } else {
            ctx.audio?.play('whoosh');
          }
        },
      },
      {
        slot: 'E', name: 'Chain Pull', cooldown: 7, chargeable: true,
        desc: 'Yank the enemy under your crosshair to you. Charged: drag up to three.',
        execute(ctx) {
          const p = ctx.chargePower || 0;
          const targets = p > 0.5
            ? ctx.coneHit(28, 30).slice(0, 3)
            : ctx.rayHits(ctx.muzzle(), ctx.aimDir(), 28, 2.5).slice(0, 1);
          if (!targets.length) return false;
          for (const target of targets) {
            const tp = target.position.clone(); tp.y += target.height * 0.5;
            ctx.effects.beam(ctx.muzzle(), tp, { color: 0xffd76a, radius: 0.09, life: 0.3 });
            const pull = _v1.copy(ctx.player.position).sub(target.position);
            const dist = pull.length();
            pull.normalize().multiplyScalar(Math.min(dist * 2.2, 34)).y = 6;
            ctx.dealDamage(target, 10, { knockback: pull });
            target.aggro = true;
          }
          ctx.audio?.play('pull');
        },
      },
      {
        slot: 'R', name: 'Battle Roar', cooldown: 12, chargeable: true,
        desc: 'Taunt everything near and raise a golden overshield around yourself.',
        execute(ctx, state) {
          const p = ctx.chargePower || 0;
          const c = ctx.player.position.clone();
          for (const e of ctx.sphereHit(c, 20)) e.aggro = true;
          ctx.player.grantShield(28 + 22 * p, 7);
          state.drT = 1.5;
          ctx.effects.glow(c.clone().add(_v1.set(0, 1.3, 0)), { color: 0xffd76a, size: 3.5, life: 0.5, grow: 3 });
          ctx.effects.ring(c, { color: 0xffd76a, endRadius: 20, life: 0.6, thickness: 0.4, opacity: 0.5 });
          ctx.shake(0.25);
          ctx.audio?.play('roar');
        },
      },
      {
        slot: 'F', name: 'Bulwark Dome', cooldown: 16, chargeable: true,
        desc: 'A dome that blocks enemy shots, slows enemies inside, and heals you.',
        execute(ctx) {
          const p = ctx.chargePower || 0;
          ctx.game.spawnDome(ctx.player.position.clone(), 6 + 2.5 * p, 6 + 3 * p);
          ctx.audio?.play('dome');
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
        const fwd = ctx.player.forwardDir(false);
        for (const e of hits) {
          const toPlayer = _v1.copy(ctx.player.position).sub(e.position).normalize();
          const behind = e.facing && toPlayer.dot(e.facing) < -0.25;
          let dmg = 16;
          if (behind) dmg *= 2.2;
          ctx.dealDamage(e, dmg, { knockback: _v2.copy(fwd).multiplyScalar(5).setY(2.5), poison: voidPoison() });
          if (behind) {
            ctx.effects.burst(e.position.clone().setY(e.position.y + e.height * 0.7), {
              count: 16, color: 0xbb66ff, speed: 8, size: 0.26, life: 0.4,
            });
            ctx.game.hitstop(0.035);
          }
        }
        if (hits.length) ctx.audio?.play('slash');
        else ctx.audio?.play('whoosh');
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
            pos: ctx.muzzle(), vel: dir.multiplyScalar(46),
            damage: 14 * (1 + 0.7 * p), color: 0x9a5fff, coreColor: 0xe0ccff,
            size: 0.7 + 0.35 * p, radius: 0.8 + 0.4 * p,
            knockback: 5, pierce: true, life: 0.7, gravity: 0,
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

export const CLASS_LIST = ['mage', 'brawler', 'reaver', 'warden', 'assassin'];
