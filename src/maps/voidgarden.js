import * as THREE from 'three';
import { mulberry32, randRange } from '../utils.js';
import { Overtime } from '../overtime.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

// grown-Maw far field tuning: continuous with the near-field's floor value
// (45, the strength right at d===pullR) and decaying like ~1/d^2 beyond it.
const MAW_FAR_BASE = 45;
const MAW_FAR_SPREAD = 14;

// ---------------------------------------------------------------------------
// THE MAW: a black hole hanging over the central garden. Drift too close and
// it drags you in, holds you at its heart for a beat, then hurls you out in
// a random skyward direction. Never deals damage — it's a ride, and a trap.
// Affects only the local player (each client rides its own maw), so nothing
// needs network sync; a grace period stops instant re-grabs.
//
// Once overtime grows the Maw (this.farField, set by MawOvertime.begin),
// its gravity stops being a hard-radius trap and becomes a field that
// covers the whole arena: full strength inside pullR (unchanged), then a
// smooth 1/d^2-shaped falloff beyond it — a gentle trajectory-bending pull
// far out, never strong enough on its own to reel in a grounded player.
// Pure movement force, no damage; mirrors into bot brainVel in MawOvertime.
// ---------------------------------------------------------------------------
class MawHazard {
  constructor(world, game) {
    this.world = world;
    this.game = game;
    this.center = new THREE.Vector3(0, 14, 0);
    this.pullR = 11;
    this.holding = false;
    this.holdT = 0;
    this.grace = 0;
    this.t = 0;
    this.farField = false;   // flips true once overtime grows the Maw

    const fx = world.hazardFx;
    // one group holds every Maw mesh so the whole thing can move (overtime
    // sends it hunting); children sit at origin-relative positions
    this.g = new THREE.Group();
    this.g.position.copy(this.center);
    fx.add(this.g);
    // the void core
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(2.1, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    this.g.add(core);
    // event-horizon shimmer: an additive backside shell around the core
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 20, 14),
      new THREE.MeshBasicMaterial({
        color: 0x8844ff, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
      })
    );
    this.g.add(shell);
    // twin accretion disks, counter-tilted
    this.disks = [];
    for (const [tilt, color, r] of [[0.5, 0xa060ff, 3.9], [-0.35, 0x55ddff, 3.1]]) {
      const disk = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.22, 8, 40),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.65,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      disk.rotation.x = Math.PI / 2 + tilt;
      this.g.add(disk);
      this.disks.push(disk);
    }
    const light = new THREE.PointLight(0x9a5fff, 40, 60, 2);
    this.g.add(light);

    // spiraling infall particles sketch the pull radius
    const N = 100;
    this.parts = Array.from({ length: N }, (_, i) => ({
      r: 3 + (i / N) * (this.pullR - 3),
      ang: Math.random() * Math.PI * 2,
      y: (Math.random() - 0.5) * 4,
      speed: 0.6 + Math.random() * 0.8,
    }));
    const pos = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.swirl = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xc09aff, size: 0.42, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.g.add(this.swirl);

    this.holdDps = 0;   // overtime turns the hold lethal
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    this.g.position.copy(this.center);
    this.disks[0].rotation.z += dt * 1.4;
    this.disks[1].rotation.z -= dt * 1.9;

    // particles spiral inward, respawning at the field's edge
    // (positions are center-relative: the whole group rides this.center)
    const attr = this.swirl.geometry.attributes.position;
    for (let i = 0; i < this.parts.length; i++) {
      const part = this.parts[i];
      part.ang += dt * part.speed * (this.pullR / part.r);
      part.r -= dt * (0.5 + (this.pullR - part.r) * 0.12);
      if (part.r < 2.4) { part.r = this.pullR; part.ang = Math.random() * Math.PI * 2; part.y = (Math.random() - 0.5) * 4; }
      attr.setXYZ(
        i,
        Math.cos(part.ang) * part.r,
        part.y * (part.r / this.pullR),
        Math.sin(part.ang) * part.r
      );
    }
    attr.needsUpdate = true;

    const p = g.player;
    if (this.grace > 0) this.grace -= dt;

    if (this.holding) {
      this.holdT -= dt;
      p.root(0.2);                       // no wriggling inside a black hole
      _v1.copy(this.center); _v1.y -= 1; // feet at the heart
      p.position.lerp(_v1, 1 - Math.exp(-16 * dt));
      p.vel.set(0, 0, 0);
      // overtime: the hold crushes
      if (this.holdDps > 0 && p.alive) {
        p.health -= this.holdDps * dt;
        p.lastDamagedAt = g.simTime;
        if (p.health <= 0) { p.health = 0; p.alive = false; p.onDeath?.(); }
      }
      if (Math.random() < dt * 20) {
        g.effects.glow(this.center.clone().add(_v2.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3)), {
          color: 0xa060ff, size: 0.8, life: 0.2, grow: -0.8,
        });
      }
      if (this.holdT <= 0) {
        this.holding = false;
        this.grace = 4;
        // hurled out skyward in a random direction — never into the ground
        const yaw = Math.random() * Math.PI * 2;
        const el = (55 + Math.random() * 30) * (Math.PI / 180);
        p.vel.set(Math.cos(yaw) * Math.cos(el), Math.sin(el), Math.sin(yaw) * Math.cos(el)).multiplyScalar(52);
        p.slowFall(0.8);   // hang at the top of the throw — it should feel HUGE
        p.invulnTimer = Math.max(p.invulnTimer, 0.5);
        g.effects.impactBurst(this.center.clone(), { color: 0xa060ff, size: 5 });
        g.effects.ring(this.center.clone(), { color: 0x55ddff, endRadius: 8, life: 0.5, thickness: 0.5 });
        g.hud?.flash('rgba(150, 90, 255, 0.2)', 0.3);
        g.player.shake(0.4);
        g.audio?.play('explosion');
      }
      return;
    }

    if (!p.alive || this.grace > 0) return;
    _v1.copy(p.position); _v1.y += 1;
    const d = _v1.distanceTo(this.center);
    if (d < this.pullR) {
      // a REAL pull: heavy acceleration, gravity softened, and the walk-speed
      // cap lifted (windBoostT) so the clamp can't fight the infall
      _v2.copy(this.center).sub(_v1).normalize();
      p.vel.addScaledVector(_v2, dt * (45 + 130 * (1 - d / this.pullR)));
      p.windBoostT = 0.25;
      p.slowFall(0.2);
      if (Math.random() < dt * 8) {
        g.effects.glow(p.position.clone().add(_v1.set(0, 1, 0)), { color: 0xa060ff, size: 0.6, life: 0.15 });
      }
      if (d < 2.2) {
        this.holding = true;
        this.holdT = 1.0;
        p.root(1.2);
        g.audio?.play('windup');
        g.effects.ring(this.center.clone(), { color: 0xa060ff, endRadius: 5, life: 0.4, thickness: 0.4 });
      }
    } else if (this.farField) {
      // grown-Maw far field: smooth inverse-square-ish falloff beyond the
      // strong zone, continuous with it (equals 45 right at d===pullR),
      // decaying toward ~nothing at arena-far range. No damage, no speed
      // clamp override — just a curve on top of normal movement.
      _v2.copy(this.center).sub(_v1).normalize();
      const beyond = d - this.pullR;
      const a = MAW_FAR_BASE / (1 + (beyond / MAW_FAR_SPREAD) ** 2);
      p.vel.addScaledVector(_v2, dt * a);
    }
  }
}

// ---------------------------------------------------------------------------
// OVERTIME — THE MAW AWAKENS: the black hole swells, its pull reaching ever
// further; it reels the five orbiting gardens in and crunches them one by
// one. Its grip turns lethal. When nothing is left to eat, it goes hunting.
// ---------------------------------------------------------------------------
class MawOvertime extends Overtime {
  begin() {
    this.hunting = false;
    this.hunt0 = 0;
    const maw = this.world.hazards;
    if (maw) {
      maw.holdDps = 16;
      maw.grace = Math.min(maw.grace, 2);
      maw.farField = true;   // gravity now reaches the whole arena
    }
  }

  _nearestTarget() {
    const g = this.game;
    let best = g.player.alive ? g.player.position : null;
    if (g.mode === 'botduel') {
      for (const e of g.enemies) {
        if (e.type !== 'duelist' || !e.alive) continue;
        const maw = this.world.hazards;
        if (!best || e.position.distanceTo(maw.center) < best.distanceTo(maw.center)) {
          best = e.position;
        }
      }
    }
    return best;
  }

  tick(dt) {
    const w = this.world, g = this.game;
    const maw = w.hazards;
    if (!maw) return;

    // the Maw swells
    maw.pullR += 0.45 * dt;
    const k = 0.65 + (maw.pullR / 11) * 0.35;
    maw.g.scale.setScalar(k);

    // it reels the orbiting gardens in and eats them
    let orbiting = 0;
    for (let i = w.platforms.length - 1; i >= 0; i--) {
      const p = w.platforms[i];
      if (!p.orbit) continue;
      orbiting++;
      p.orbit.r -= 2.6 * dt;
      if (p.orbit.r < 5) {
        const pos = p.mesh ? p.mesh.position.clone() : _v3.set(p.x, p.baseY, p.z).clone();
        g.effects.impactBurst(pos.clone(), { color: 0xa060ff, size: 5 });
        g.effects.burst(pos.clone(), { count: 34, color: 0xc09aff, color2: 0x55ddff, speed: 12, size: 0.35, life: 0.6 });
        g.effects.ring(maw.center.clone(), { color: 0xa060ff, endRadius: 7, life: 0.5, thickness: 0.5 });
        g.player.shake(0.4);
        g.audio?.play('explosion');
        w.removePlatform(p);
        if (p.mesh) p.mesh.visible = false;
        this.log.push([Math.round(w.hazardClock), 'crunch']);
        orbiting--;
      }
    }

    // nothing left to eat: THE HUNT
    if (!orbiting && !this.hunting) {
      this.hunting = true;
      this.hunt0 = this.t;
      g.hud?.announce('THE MAW HUNGERS', 'sub');
      this.log.push([Math.round(w.hazardClock), 'hunt']);
    }
    if (this.hunting) {
      const target = this._nearestTarget();
      if (target) {
        const speed = Math.min(4.5, 1.8 + (this.t - this.hunt0) * 0.02);
        _v3.copy(target).setY(target.y + 4).sub(maw.center);
        const d = _v3.length();
        if (d > 0.5) maw.center.addScaledVector(_v3.normalize(), Math.min(speed * dt, d));
      }
    }

    // in a bot duel the Maw also drags the bot's body (its brain fights back)
    // — mirrors the player's near-field pull and grown-Maw far field, both
    // pure movement force (only the sub-2.5 crush deals damage, unchanged)
    if (g.mode === 'botduel') {
      for (const e of g.enemies) {
        if (e.type !== 'duelist' || !e.alive || !e.brainVel) continue;
        _v3.copy(e.position).setY(e.position.y + 1);
        const d = _v3.distanceTo(maw.center);
        _v2.copy(maw.center).sub(_v3).normalize();
        if (d < maw.pullR) {
          e.brainVel.addScaledVector(_v2, dt * (45 + 130 * (1 - d / maw.pullR)));
          if (d < 2.5) e.takeDamage(maw.holdDps * dt, { source: 'hazard' });
        } else {
          const beyond = d - maw.pullR;
          const a = MAW_FAR_BASE / (1 + (beyond / MAW_FAR_SPREAD) ** 2);
          e.brainVel.addScaledVector(_v2, dt * a);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Voidgarden: a night garden adrift in a starfield, aurora overhead.
// Signature verb: ORBITING GROUND — five garden platforms slowly circle the
// central island, so the battlefield rearranges itself as you fight (and
// standing your ground literally carries you around the map).
// ---------------------------------------------------------------------------

let _flowerTex = null;
function makeFlowerTexture() {
  if (_flowerTex) return _flowerTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  const rng = mulberry32(99);
  // a few luminous blossoms on thin stems
  for (let f = 0; f < 3; f++) {
    const x = 12 + rng() * 40;
    const stemH = 20 + rng() * 26;
    ctx.strokeStyle = 'rgba(80,200,170,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x, 64 - stemH);
    ctx.stroke();
    const cyan = rng() < 0.5;
    ctx.fillStyle = cyan ? 'rgba(110,255,230,0.95)' : 'rgba(255,120,240,0.95)';
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * 4, 64 - stemH + Math.sin(a) * 4, 3.4, 2.2, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(x, 64 - stemH, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  _flowerTex = new THREE.CanvasTexture(c);
  _flowerTex.colorSpace = THREE.SRGBColorSpace;
  return _flowerTex;
}

export const VOIDGARDEN = {
  id: 'voidgarden',
  name: 'VOIDGARDEN',
  blurb: 'the garden rearranges itself',

  env: {
    sunDir: [-0.3, 0.55, 0.78],   // a bright moon, opposite the usual sun
    sunColor: 0xbfd4ff,
    sunIntensity: 1.8,
    hemi: [0x4a5a95, 0x2a2148, 1.05],
    fog: { color: '#2c2450', near: 85, far: 560 },
    sky: {
      zenith: '#141a3e', mid: '#2a2058', horizon: '#4c3c7e', sun: '#e0ecff',
      starHeight: 0.05, starDensity: 0.993, aurora: 0.55, auroraColor: 0x44ffcc,
    },
    glow: [
      { scale: 260, opacity: 0.5, color: 0xafc8ff },
      { scale: 120, opacity: 0.8, color: 0xe8f0ff },
    ],
    clouds: { tintA: 0x2a2a4a, tintB: 0x44406e, low: 12, far: 8, high: 4 },
    motes: { color: 0x88ffd8, count: 320 },
    palette: {
      grassA: '#2a5a55', grassB: '#3a7a68', grassWarm: '#6a4a9a',
      dirt: '#3a3050', rockA: '#3e3a5c', rockB: '#282444', rockTip: '#181430',
      stone: '#5a5480', stoneDark: '#3e3a5e',
      leafA: '#2a6a5a', leafB: '#3a8a72', leafWarmA: '#7a3a9a', leafWarmB: '#a050c0',
      crystalA: 0x66ffe0, crystalB: 0xff66e8,
    },
  },

  // central garden + three static outposts; the orbiting five are platforms
  islands: [
    { x: 0, z: 0, topY: 0, R: 16, domeH: 1.3, depth: 22, seed: 401, trees: 5, rocks: 4, crystals: 3 },
    { x: 55, z: 10, topY: 8, R: 8, domeH: 1.0, depth: 14, seed: 413, trees: 2, rocks: 2, crystals: 2 },
    { x: -34, z: 46, topY: 12, R: 8, domeH: 1.0, depth: 14, seed: 427, trees: 2, rocks: 2, crystals: 2 },
    { x: -20, z: -54, topY: 5, R: 8, domeH: 1.0, depth: 14, seed: 439, trees: 2, rocks: 2, crystals: 2 },
  ],

  // the five orbiting gardens (mossy-rock tops, full lap 40-75s)
  platformSeed: 808,
  platforms: [
    { x: 26, z: 0, baseY: 3, R: 6.5, amp: 0.6, speed: 0.3, phase: 0, orbit: { cx: 0, cz: 0, r: 26, angSpeed: 0.14, phase: 0 } },
    { x: 30, z: 0, baseY: 7, R: 5.5, amp: 0.7, speed: 0.35, phase: 1, orbit: { cx: 0, cz: 0, r: 30, angSpeed: -0.1, phase: 1.26 } },
    { x: 35, z: 0, baseY: 11, R: 6, amp: 0.6, speed: 0.3, phase: 2, orbit: { cx: 0, cz: 0, r: 35, angSpeed: 0.12, phase: 2.51 } },
    { x: 40, z: 0, baseY: 5, R: 5, amp: 0.8, speed: 0.4, phase: 3, orbit: { cx: 0, cz: 0, r: 40, angSpeed: -0.085, phase: 3.77 } },
    { x: 45, z: 0, baseY: 14, R: 5.5, amp: 0.6, speed: 0.3, phase: 4, orbit: { cx: 0, cz: 0, r: 45, angSpeed: 0.095, phase: 5.03 } },
  ],

  build(world, root, rng) {
    // ---- luminous flowers across the central garden ----
    const blade = new THREE.PlaneGeometry(1.0, 0.9);
    blade.translate(0, 0.42, 0);
    const geoA = blade;
    const geoB = blade.clone().rotateY(Math.PI / 2);
    const merged = new THREE.BufferGeometry();
    // simple two-plane cross without addon helpers: merge by hand
    const pos = new Float32Array([...geoA.attributes.position.array, ...geoB.attributes.position.array]);
    const uv = new Float32Array([...geoA.attributes.uv.array, ...geoB.attributes.uv.array]);
    const idxB = Array.from(geoB.index.array).map((i) => i + geoA.attributes.position.count);
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.setIndex([...Array.from(geoA.index.array), ...idxB]);
    merged.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      map: makeFlowerTexture(), alphaTest: 0.35, side: THREE.DoubleSide,
      transparent: true, depthWrite: false,
    });
    const island = world.islands[0];
    const N = 90;
    const inst = new THREE.InstancedMesh(merged, mat, N);
    const dummy = new THREE.Object3D();
    let placed = 0;
    const frng = mulberry32(4141);
    for (let i = 0; i < N * 3 && placed < N; i++) {
      const a = frng() * Math.PI * 2;
      const rr = Math.sqrt(frng()) * island.R * 0.9;
      const x = island.x + Math.cos(a) * rr;
      const z = island.z + Math.sin(a) * rr;
      const y = world.groundHeightBelow(x, z, 30, 0, 1);
      if (y === null) continue;
      dummy.position.set(x, y - 0.02, z);
      dummy.rotation.y = frng() * Math.PI;
      const s = randRange(frng, 0.7, 1.3);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      inst.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    root.add(inst);

    // ---- void mist: broad dark veils floating far below ----
    const mistTex = (() => {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 64;
      const ctx = c.getContext('2d');
      const g2 = ctx.createRadialGradient(64, 32, 4, 64, 32, 60);
      g2.addColorStop(0, 'rgba(30,20,60,0.55)');
      g2.addColorStop(1, 'rgba(30,20,60,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, 128, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const mrng = mulberry32(2727);
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: mistTex, transparent: true, opacity: randRange(mrng, 0.4, 0.7),
        depthWrite: false, fog: false,
      }));
      const a = mrng() * Math.PI * 2;
      const d = randRange(mrng, 20, 90);
      s.position.set(Math.cos(a) * d, randRange(mrng, -48, -26), Math.sin(a) * d);
      s.scale.set(randRange(mrng, 60, 110), randRange(mrng, 18, 30), 1);
      root.add(s);
    }
  },

  makeHazards(world, game) {
    return new MawHazard(world, game);
  },

  makeOvertime(world, game) {
    return new MawOvertime(world, game);
  },

  spawns: {
    solo: [0, 3, 10],
    duel: [[52, 10, 10, Math.PI / 2], [-32, 14, 44, 2.5]],
    ffa: [[0, 3, 10, 0], [52, 10, 10, Math.PI / 2], [-32, 14, 44, 2.5], [-18, 7, -50, -0.4]],
  },
};
