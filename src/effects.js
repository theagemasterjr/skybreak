import * as THREE from 'three';
import { randRange, mulberry32 } from './utils.js';

// ---------------------------------------------------------------------------
// Effects: pooled-ish VFX manager — particle bursts, glow sprites, beams,
// expanding rings, and lingering area markers. Everything is short-lived and
// self-disposing.
// ---------------------------------------------------------------------------

let _burstTex = null;
function burstTexture() {
  if (_burstTex) return _burstTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.translate(64, 64);
  // comic starburst: irregular radial spikes
  const spikes = 12;
  ctx.fillStyle = 'rgba(255,255,255,1)';
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2;
    const len = 30 + (i % 3) * 16 + Math.sin(i * 7.3) * 8;
    const w = 0.10 + (i % 2) * 0.05;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a - w) * 8, Math.sin(a - w) * 8);
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.lineTo(Math.cos(a + w) * 8, Math.sin(a + w) * 8);
    ctx.closePath();
    ctx.fill();
  }
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 20);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-24, -24, 48, 48);
  _burstTex = new THREE.CanvasTexture(c);
  return _burstTex;
}

let _glowTex = null;
let _beamGeo = null;
function beamGeometry() {
  if (!_beamGeo) _beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  return _beamGeo;
}

let _sphereGeo = null;
function sphereGeometry() {
  if (!_sphereGeo) _sphereGeo = new THREE.SphereGeometry(1, 20, 14);
  return _sphereGeo;
}

function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

const _v = new THREE.Vector3();

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];   // {update(dt) -> false when done, dispose()}
    this.rng = mulberry32(1234);
  }

  _add(item) { this.items.push(item); }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (!this.items[i].update(dt)) {
        this.items[i].dispose();
        this.items.splice(i, 1);
      }
    }
  }

  // ---- particle burst ----
  burst(pos, {
    count = 18, color = 0xffaa55, color2 = null, speed = 9, size = 0.28,
    life = 0.55, gravity = 12, spread = 1, direction = null, additive = true,
  } = {}) {
    const N = count;
    const positions = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    const vels = [];
    const cA = new THREE.Color(color);
    const cB = color2 ? new THREE.Color(color2) : cA.clone().multiplyScalar(0.55);
    const c = new THREE.Color();
    const rng = this.rng;
    for (let i = 0; i < N; i++) {
      positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y; positions[i * 3 + 2] = pos.z;
      const dir = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      if (direction) dir.multiplyScalar(spread).add(direction).normalize();
      vels.push(dir.multiplyScalar(speed * randRange(rng, 0.35, 1)));
      c.lerpColors(cA, cB, rng());
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      map: glowTexture(), size, vertexColors: true, transparent: true,
      depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    let t = 0;
    const scene = this.scene;
    this._add({
      update: (dt) => {
        t += dt;
        const posAttr = geo.attributes.position;
        for (let i = 0; i < N; i++) {
          vels[i].y -= gravity * dt;
          posAttr.setXYZ(i,
            posAttr.getX(i) + vels[i].x * dt,
            posAttr.getY(i) + vels[i].y * dt,
            posAttr.getZ(i) + vels[i].z * dt);
        }
        posAttr.needsUpdate = true;
        mat.opacity = Math.max(0, 1 - t / life);
        return t < life;
      },
      dispose: () => { scene.remove(points); geo.dispose(); mat.dispose(); },
    });
  }

  // ---- single glow sprite (muzzle flash, trail puff, pickup shine) ----
  glow(pos, { color = 0xffffff, size = 1, life = 0.25, grow = 0, fade = true, additive = true } = {}) {
    const mat = new THREE.SpriteMaterial({
      map: glowTexture(), color, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.setScalar(size);
    this.scene.add(s);
    let t = 0;
    const scene = this.scene;
    this._add({
      update: (dt) => {
        t += dt;
        if (grow) s.scale.setScalar(size + grow * t);
        if (fade) mat.opacity = Math.max(0, 1 - t / life);
        return t < life;
      },
      dispose: () => { scene.remove(s); mat.dispose(); },
    });
    return s;
  }

  // ---- beam between two points ----
  // one shared unit cylinder, scaled per beam: building fresh geometry every
  // shot made rapid-fire hitscan weapons (minigun) stutter
  beam(from, to, { color = 0x88ddff, radius = 0.14, life = 0.18, coreColor = 0xffffff } = {}) {
    const dir = _v.copy(to).sub(from);
    const len = dir.length();
    const group = new THREE.Group();
    const mk = (r, c, op) => {
      const mat = new THREE.MeshBasicMaterial({
        color: c, transparent: true, opacity: op, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(beamGeometry(), mat);
      m.scale.set(r, len, r);
      m.rotation.x = Math.PI / 2;
      group.add(m);
      return mat;
    };
    const matOuter = mk(radius, color, 0.7);
    const matInner = mk(radius * 0.4, coreColor, 1);
    group.position.copy(from).add(dir.multiplyScalar(0.5));
    group.lookAt(to);
    this.scene.add(group);
    let t = 0;
    const scene = this.scene;
    this._add({
      update: (dt) => {
        t += dt;
        const k = Math.max(0, 1 - t / life);
        matOuter.opacity = 0.7 * k;
        matInner.opacity = k;
        return t < life;
      },
      dispose: () => {
        scene.remove(group);
        // geometry is shared — only the materials belong to this beam
        group.children.forEach(m => m.material.dispose());
      },
    });
  }

  // ---- expanding sphere shell (3D pulses — shared geometry, cheap) ----
  sphere(pos, { color = 0xffcc55, startRadius = 0.4, endRadius = 5, life = 0.3, opacity = 0.5 } = {}) {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(sphereGeometry(), mat);
    m.position.copy(pos);
    m.scale.setScalar(startRadius);
    this.scene.add(m);
    let t = 0;
    const scene = this.scene;
    this._add({
      update: (dt) => {
        t += dt;
        const k = t / life;
        m.scale.setScalar(startRadius + (endRadius - startRadius) * (1 - Math.pow(1 - k, 2.2)));
        mat.opacity = opacity * Math.max(0, 1 - k);
        return t < life;
      },
      dispose: () => { scene.remove(m); mat.dispose(); },
    });
  }

  // ---- expanding ring (shockwaves, novas). axis 'y' = flat on ground ----
  ring(pos, {
    color = 0x88ddff, startRadius = 0.5, endRadius = 8, life = 0.45,
    axis = 'y', opacity = 0.9, thickness = 0.35,
  } = {}) {
    const geo = new THREE.TorusGeometry(1, thickness / 2, 8, 48);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(geo, mat);
    if (axis === 'y') m.rotation.x = Math.PI / 2;
    m.position.copy(pos);
    m.scale.setScalar(startRadius);
    this.scene.add(m);
    let t = 0;
    const scene = this.scene;
    this._add({
      update: (dt) => {
        t += dt;
        const k = t / life;
        const r = startRadius + (endRadius - startRadius) * (1 - Math.pow(1 - k, 2.2));
        m.scale.set(r, r, r * (axis === 'y' ? 0.4 : 1));
        mat.opacity = opacity * Math.max(0, 1 - k);
        return t < life;
      },
      dispose: () => { scene.remove(m); geo.dispose(); mat.dispose(); },
    });
  }

  // ---- ground target marker (telegraphs) ----
  marker(pos, { color = 0xff5533, radius = 5, life = 0.9 } = {}) {
    const geo = new THREE.RingGeometry(radius * 0.92, radius, 40);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos).add(_v.set(0, 0.12, 0));

    const fillGeo = new THREE.CircleGeometry(radius, 40);
    const fillMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.12, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.rotation.x = -Math.PI / 2;
    fill.position.copy(ring.position);

    const group = new THREE.Group();
    group.add(ring); group.add(fill);
    this.scene.add(group);
    let t = 0;
    const scene = this.scene;
    this._add({
      update: (dt) => {
        t += dt;
        const pulse = 0.6 + 0.4 * Math.sin(t * 18);
        mat.opacity = 0.9 * pulse;
        fillMat.opacity = 0.1 + 0.14 * (t / life); // fills in as it's about to hit
        return t < life;
      },
      dispose: () => {
        scene.remove(group);
        geo.dispose(); mat.dispose(); fillGeo.dispose(); fillMat.dispose();
      },
    });
  }

  // ---- comic-book starburst impact frame ----
  impactBurst(pos, { color = 0xffe9a8, size = 2.2, life = 0.22 } = {}) {
    const mat = new THREE.SpriteMaterial({
      map: burstTexture(), color, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, rotation: Math.random() * Math.PI,
    });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.setScalar(size * 0.5);
    this.scene.add(s);
    let t = 0;
    const scene = this.scene;
    this._add({
      update: (dt) => {
        t += dt;
        const k = t / life;
        s.scale.setScalar(size * (0.5 + k * 0.9));
        mat.opacity = Math.max(0, 1 - k * k);
        return t < life;
      },
      dispose: () => { scene.remove(s); mat.dispose(); },
    });
    // punch it up with a white core flash
    this.glow(pos, { color: 0xffffff, size: size * 0.7, life: life * 0.6, grow: size });
  }

  // ---- quick dash streak lines around camera (speed feel) ----
  dashStreaks(camera) {
    // brief FOV streak sprites moving past the camera
    for (let i = 0; i < 6; i++) {
      const off = new THREE.Vector3(
        randRange(this.rng, -1.5, 1.5),
        randRange(this.rng, -1, 1),
        -randRange(this.rng, 1.5, 4)
      ).applyQuaternion(camera.quaternion);
      const p = camera.position.clone().add(off);
      this.glow(p, { color: 0xcfe8ff, size: randRange(this.rng, 0.1, 0.3), life: 0.22, grow: 2.5 });
    }
  }
}
