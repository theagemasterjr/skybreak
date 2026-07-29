import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, fbm2, noise2, lerp, clamp, randRange } from './utils.js';

// ---------------------------------------------------------------------------
// World: the floating sky-island arena. Owns environment meshes, lighting,
// sky, clouds, and the ground-collision model used by player and enemies.
// ---------------------------------------------------------------------------

const PALETTE = {
  zenith: new THREE.Color('#2b3a6e'),
  mid: new THREE.Color('#8a4a74'),
  horizon: new THREE.Color('#ff9a55'),
  sun: new THREE.Color('#fff2c4'),
  fog: new THREE.Color('#d97e55'),
  grassA: new THREE.Color('#5da24f'),
  grassB: new THREE.Color('#8fba55'),
  grassWarm: new THREE.Color('#b0a04a'),
  dirt: new THREE.Color('#8a6a4a'),
  rockA: new THREE.Color('#7d6f68'),
  rockB: new THREE.Color('#57493f'),
  rockTip: new THREE.Color('#3a2f2a'),
  stone: new THREE.Color('#b5a289'),
  stoneDark: new THREE.Color('#8f7d66'),
};

export const SUN_DIR = new THREE.Vector3(0.38, 0.30, -0.87).normalize();

export class World {
  constructor(scene) {
    this.scene = scene;
    this.islands = [];      // static islands: {x, z, topY, R, domeH, edgeSeed}
    this.platforms = [];    // bobbing platforms: {x, z, baseY, R, amp, speed, phase, mesh}
    this.columns = [];      // cylinder colliders: {x, z, r, yBottom, yTop}
    this.crystals = [];     // pulsing emissive materials
    this.cloudGroup = null;
    this.time = 0;

    this._buildLights();
    this._buildSky();
    this._buildIslands();
    this._buildPlatforms();
    this._buildClouds();
    this._buildMotes();
  }

  // ---- lighting ----
  _buildLights() {
    const hemi = new THREE.HemisphereLight(0x6a79c9, 0xb06a45, 0.85);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffd9a3, 2.6);
    sun.position.copy(SUN_DIR).multiplyScalar(180);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 40;
    sun.shadow.camera.far = 420;
    sun.shadow.camera.left = -95;
    sun.shadow.camera.right = 95;
    sun.shadow.camera.top = 95;
    sun.shadow.camera.bottom = -95;
    sun.shadow.bias = -0.0015;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.sun = sun;

    this.scene.fog = new THREE.Fog(PALETTE.fog.getHex(), 110, 620);
  }

  // ---- sky dome + sun glow ----
  _buildSky() {
    const geo = new THREE.SphereGeometry(950, 32, 24);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        sunDir: { value: SUN_DIR.clone() },
        zenith: { value: PALETTE.zenith },
        mid: { value: PALETTE.mid },
        horizon: { value: PALETTE.horizon },
        sunColor: { value: PALETTE.sun },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 sunDir, zenith, mid, horizon, sunColor;
        varying vec3 vDir;

        float hash(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yzx + 19.19);
          return fract((p.x + p.y) * p.z);
        }

        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y, -1.0, 1.0);

          // three-stop vertical gradient
          vec3 col;
          if (h > 0.0) {
            col = mix(mid, zenith, pow(clamp(h * 1.6, 0.0, 1.0), 0.75));
          } else {
            col = mix(mid, horizon * 0.55, pow(clamp(-h * 2.2, 0.0, 1.0), 0.8));
          }
          // warm band near horizon
          float band = exp(-abs(h - 0.02) * 9.0);
          col = mix(col, horizon, band * 0.85);

          // sun disk + glow
          float d = max(dot(dir, sunDir), 0.0);
          float glow = pow(d, 24.0) * 0.55 + pow(d, 6.0) * 0.18;
          col += sunColor * glow;
          float disk = smoothstep(0.99955, 0.99985, d);
          col += sunColor * disk * 4.0;

          // faint dusk stars overhead
          if (h > 0.22) {
            vec3 cell = floor(dir * 220.0);
            float s = hash(cell);
            if (s > 0.9965) {
              float star = (s - 0.9965) / 0.0035;
              col += vec3(0.9, 0.95, 1.0) * star * smoothstep(0.22, 0.55, h) * 0.8;
            }
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    this.scene.add(sky);

    // layered sun glow sprites
    const glowTex = makeGlowTexture();
    const mkGlow = (scale, opacity, color) => {
      const m = new THREE.SpriteMaterial({
        map: glowTex, color, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const s = new THREE.Sprite(m);
      s.position.copy(SUN_DIR).multiplyScalar(820);
      s.scale.setScalar(scale);
      this.scene.add(s);
    };
    mkGlow(500, 0.55, 0xffb36b);
    mkGlow(210, 0.9, 0xfff0c0);
  }

  // ---- island collision -------------------------------------------------
  // Edge radius varies with angle so islands have organic outlines. The same
  // function drives both mesh generation and collision, so they always agree.
  static edgeRadius(island, theta) {
    const n = noise2(Math.cos(theta) * 1.7 + island.edgeSeed, Math.sin(theta) * 1.7 + island.edgeSeed);
    return island.R * (0.82 + 0.28 * n);
  }

  static islandHeightAt(island, x, z) {
    const dx = x - island.x, dz = z - island.z;
    const r = Math.hypot(dx, dz);
    const theta = Math.atan2(dz, dx);
    const edge = World.edgeRadius(island, theta);
    if (r > edge) return null;
    const t = r / edge;
    const dome = island.domeH * (1 - t * t);
    const bump = (fbm2(x * 0.08 + island.edgeSeed, z * 0.08 - island.edgeSeed, 3) - 0.5) * 1.1 * (1 - t * 0.6);
    return island.topY + dome + bump;
  }

  // Underside height (approx.) — mirrors the tapered rock cone from
  // buildIslandGeometry's underVert, so islands are solid volumes with a
  // bottom, not just a top-surface heightfield. Used to stop players from
  // flying up through an island from underneath.
  static islandBottomAt(island, x, z) {
    const dx = x - island.x, dz = z - island.z;
    const r = Math.hypot(dx, dz);
    const theta = Math.atan2(dz, dx);
    const edge = World.edgeRadius(island, theta);
    if (r > edge) return null;
    const t = 1 - r / edge; // 0 at rim (meets top surface), 1 at center (deepest)
    const taper = Math.pow(t, 1 / 1.35);
    return island.topY - (island.depth || 15) * 0.85 * taper;
  }

  platformHeightAt(p, x, z, time) {
    const dx = x - p.x, dz = z - p.z;
    if (Math.hypot(dx, dz) > p.R) return null;
    return this.platformY(p, time) + 0.35 * (1 - (dx * dx + dz * dz) / (p.R * p.R));
  }

  platformY(p, time) {
    return p.baseY + Math.sin(time * p.speed + p.phase) * p.amp;
  }

  // All candidate ground heights under (x, z). Callers pick the best one.
  groundCandidates(x, z, time) {
    const out = [];
    for (const isl of this.islands) {
      const y = World.islandHeightAt(isl, x, z);
      if (y !== null) out.push(y);
    }
    for (const p of this.platforms) {
      const y = this.platformHeightAt(p, x, z, time);
      if (y !== null) out.push(y);
    }
    return out;
  }

  // Highest ground at or below refY + tolerance (for landing checks).
  groundHeightBelow(x, z, refY, time, tolerance = 0.6) {
    let best = null;
    for (const y of this.groundCandidates(x, z, time)) {
      if (y <= refY + tolerance && (best === null || y > best)) best = y;
    }
    return best;
  }

  // ---- island construction ----
  _buildIslands() {
    const defs = [
      { x: 0, z: 0, topY: 0, R: 30, domeH: 1.5, depth: 36, seed: 11, ruins: true, trees: 7, rocks: 9, crystals: 3 },
      { x: 58, z: -26, topY: 7, R: 14, domeH: 1.2, depth: 20, seed: 23, trees: 4, rocks: 4, crystals: 1 },
      { x: -52, z: 22, topY: 11, R: 12, domeH: 1.1, depth: 17, seed: 37, trees: 3, rocks: 3, crystals: 2 },
      { x: 18, z: 58, topY: 16, R: 10, domeH: 1.0, depth: 15, seed: 51, trees: 2, rocks: 3, crystals: 1 },
      { x: -38, z: -52, topY: -6, R: 13, domeH: 1.2, depth: 18, seed: 67, trees: 4, rocks: 4, crystals: 1 },
      { x: 62, z: 38, topY: -2, R: 9, domeH: 0.9, depth: 13, seed: 83, trees: 2, rocks: 2, crystals: 1 },
    ];

    const islandMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, metalness: 0, flatShading: true,
    });

    for (const d of defs) {
      const island = { x: d.x, z: d.z, topY: d.topY, R: d.R, domeH: d.domeH, edgeSeed: d.seed, depth: d.depth };
      this.islands.push(island);

      const geo = buildIslandGeometry(island, d.depth, d.seed);
      const mesh = new THREE.Mesh(geo, islandMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      const rng = mulberry32(d.seed * 977 + 5);
      this._decorate(island, d, rng);
    }
  }

  _decorate(island, d, rng) {
    const placeOnIsland = (marginT = 0.85) => {
      // rejection-sample a point inside the island edge
      for (let i = 0; i < 12; i++) {
        const a = rng() * Math.PI * 2;
        const rr = Math.sqrt(rng()) * island.R * marginT;
        const x = island.x + Math.cos(a) * rr;
        const z = island.z + Math.sin(a) * rr;
        const y = World.islandHeightAt(island, x, z);
        if (y !== null) return new THREE.Vector3(x, y, z);
      }
      return new THREE.Vector3(island.x, island.topY + island.domeH, island.z);
    };

    // trees
    for (let i = 0; i < d.trees; i++) {
      const p = placeOnIsland(0.8);
      if (d.ruins && Math.hypot(p.x - island.x, p.z - island.z) < 12) { i--; continue; }
      this.scene.add(makeTree(rng, p));
    }
    // rocks
    for (let i = 0; i < d.rocks; i++) {
      const p = placeOnIsland(0.92);
      this.scene.add(makeRock(rng, p));
    }
    // crystals
    for (let i = 0; i < d.crystals; i++) {
      const p = placeOnIsland(0.75);
      const { group, mat } = makeCrystalCluster(rng, p);
      this.scene.add(group);
      this.crystals.push(mat);
    }
    // grass tufts
    this.scene.add(makeGrassTufts(island, rng, Math.floor(island.R * island.R * 0.55)));
    // ruins centerpiece on the main island
    if (d.ruins) this._buildRuins(island);
  }

  _buildRuins(island) {
    const rng = mulberry32(4242);
    const group = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true,
    });

    // ring of broken columns
    const n = 7;
    const ringR = 10;
    const geos = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const x = island.x + Math.cos(a) * ringR;
      const z = island.z + Math.sin(a) * ringR;
      const y = World.islandHeightAt(island, x, z) ?? island.topY;
      const broken = rng() < 0.45;
      const h = broken ? randRange(rng, 1.2, 2.6) : randRange(rng, 4.2, 5.6);
      const col = makeColumnGeometry(rng, h, broken);
      col.translate(x, y, z);
      geos.push(col);
      this.columns.push({ x, z, r: 0.85, yBottom: y, yTop: y + h + 0.6 });
      // fallen chunk next to broken columns
      if (broken) {
        const chunk = new THREE.CylinderGeometry(0.55, 0.62, randRange(rng, 0.9, 1.6), 7);
        paintGeometry(chunk, PALETTE.stone, PALETTE.stoneDark, rng, 0.25);
        chunk.rotateZ(Math.PI / 2 + randRange(rng, -0.4, 0.4));
        chunk.rotateY(rng() * Math.PI);
        chunk.translate(x + randRange(rng, -2, 2), y + 0.5, z + randRange(rng, -2, 2));
        geos.push(chunk);
      }
    }
    // central dais: two stacked worn discs
    const dais1 = new THREE.CylinderGeometry(4.6, 5.0, 0.7, 18);
    paintGeometry(dais1, PALETTE.stone, PALETTE.stoneDark, rng, 0.2);
    dais1.translate(island.x, island.topY + island.domeH + 0.3, island.z);
    const dais2 = new THREE.CylinderGeometry(3.4, 3.7, 0.55, 16);
    paintGeometry(dais2, PALETTE.stone, PALETTE.stoneDark, rng, 0.2);
    dais2.translate(island.x, island.topY + island.domeH + 0.9, island.z);
    geos.push(dais1, dais2);

    const merged = mergeGeometries(geos.map(g => g.toNonIndexed()));
    const mesh = new THREE.Mesh(merged, stoneMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    this.scene.add(group);

    // the dais is walkable: add a tiny collision platform (static, amp 0)
    this.platforms.push({
      x: island.x, z: island.z, baseY: island.topY + island.domeH + 1.17,
      R: 3.5, amp: 0, speed: 0, phase: 0, mesh: null,
    });
    this.platforms.push({
      x: island.x, z: island.z, baseY: island.topY + island.domeH + 0.65,
      R: 4.9, amp: 0, speed: 0, phase: 0, mesh: null,
    });
  }

  // ---- bobbing stepping-stone platforms ----
  _buildPlatforms() {
    const rng = mulberry32(999);
    const rockMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, metalness: 0, flatShading: true,
    });
    const spots = [
      [30, -14, 5], [44, 4, 3], [-28, 2, 7], [-45, -18, 1], [-10, -38, -2],
      [12, 36, 9], [-22, 42, 13], [38, 52, 7], [56, 8, 2], [-2, 55, 14],
      [-48, -36, -3], [24, -44, 4],
    ];
    for (const [x, z, y] of spots) {
      const R = randRange(rng, 2.6, 4.2);
      const p = {
        x, z, baseY: y, R,
        amp: randRange(rng, 0.7, 1.4),
        speed: randRange(rng, 0.35, 0.7),
        phase: rng() * Math.PI * 2,
      };
      const island = { x: 0, z: 0, topY: 0, R, domeH: 0.35, edgeSeed: Math.floor(rng() * 1000) };
      const geo = buildIslandGeometry(island, R * 2.2, island.edgeSeed, true);
      const mesh = new THREE.Mesh(geo, rockMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      p.mesh = mesh;
      this.platforms.push(p);
    }
  }

  // ---- clouds ----
  _buildClouds() {
    const tex = makeCloudTexture();
    const group = new THREE.Group();
    const rng = mulberry32(777);

    const addCloud = (dist, y, scale, opacity) => {
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity,
        color: new THREE.Color().lerpColors(new THREE.Color(0xffd9c0), new THREE.Color(0xfff5ec), rng()),
        depthWrite: false, fog: false,
      });
      const s = new THREE.Sprite(mat);
      const a = rng() * Math.PI * 2;
      s.position.set(Math.cos(a) * dist, y, Math.sin(a) * dist);
      s.scale.set(scale * randRange(rng, 1.4, 2.2), scale, 1);
      s.userData.angle = a;
      s.userData.dist = dist;
      s.userData.speed = randRange(rng, 0.004, 0.012) * (rng() < 0.5 ? 1 : -1);
      group.add(s);
    };

    for (let i = 0; i < 26; i++) addCloud(randRange(rng, 40, 230), randRange(rng, -70, -28), randRange(rng, 40, 95), randRange(rng, 0.5, 0.85));
    for (let i = 0; i < 12; i++) addCloud(randRange(rng, 480, 760), randRange(rng, -60, 40), randRange(rng, 160, 300), randRange(rng, 0.55, 0.8));
    for (let i = 0; i < 7; i++) addCloud(randRange(rng, 120, 300), randRange(rng, 70, 150), randRange(rng, 60, 110), randRange(rng, 0.3, 0.5));

    this.scene.add(group);
    this.cloudGroup = group;
  }

  // ---- floating dust motes ----
  _buildMotes() {
    const rng = mulberry32(31337);
    const N = 260;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = randRange(rng, -90, 90);
      pos[i * 3 + 1] = randRange(rng, -10, 40);
      pos[i * 3 + 2] = randRange(rng, -90, 90);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: makeGlowTexture(), color: 0xffcf9a, size: 0.55, transparent: true,
      opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.motes = new THREE.Points(geo, mat);
    this.scene.add(this.motes);
  }

  // ---- per-frame update ----
  update(dt, time) {
    this.time = time;
    // clouds drift
    for (const s of this.cloudGroup.children) {
      s.userData.angle += s.userData.speed * dt;
      s.position.x = Math.cos(s.userData.angle) * s.userData.dist;
      s.position.z = Math.sin(s.userData.angle) * s.userData.dist;
    }
    // platforms bob
    for (const p of this.platforms) {
      if (p.mesh) p.mesh.position.y = this.platformY(p, time);
    }
    // crystals pulse
    for (let i = 0; i < this.crystals.length; i++) {
      this.crystals[i].emissiveIntensity = 1.6 + Math.sin(time * 2.2 + i * 1.7) * 0.7;
    }
    // motes gently rise and wrap
    if (this.motes) {
      this.motes.rotation.y += dt * 0.008;
      this.motes.position.y = Math.sin(time * 0.12) * 2.5;
    }
  }
}

// ===========================================================================
// geometry + texture helpers
// ===========================================================================

// Paint a geometry's vertices between two colors with random jitter.
function paintGeometry(geo, colorA, colorB, rng, jitter = 0.15) {
  const g = geo.index ? geo : geo;
  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    c.lerpColors(colorA, colorB, rng() * 0.8);
    c.offsetHSL(0, 0, (rng() - 0.5) * jitter);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

// Build one floating island: noisy grass top + tapering rocky underside.
// Vertices are colored per-face after toNonIndexed for a faceted painterly look.
function buildIslandGeometry(island, depth, seed, bare = false) {
  const segs = Math.max(20, Math.floor(island.R * 2.2));
  const topRings = 5;
  const underRings = 6;
  const positions = [];
  const localX = island.x, localZ = island.z;

  // ring vertex helper (positions are generated in local space around 0,0
  // when bare/platform, else in world space)
  const isPlatform = bare;
  const px = isPlatform ? 0 : localX;
  const pz = isPlatform ? 0 : localZ;
  const py = isPlatform ? 0 : 0;

  const topVert = (ring, seg) => {
    const t = ring / topRings;
    const theta = (seg / segs) * Math.PI * 2;
    const edge = World.edgeRadius(island, theta);
    const r = t * edge;
    const wx = px + Math.cos(theta) * r;
    const wz = pz + Math.sin(theta) * r;
    let y;
    if (isPlatform) {
      const tt = r / edge || 0;
      y = island.topY + island.domeH * (1 - tt * tt);
    } else {
      y = World.islandHeightAt(island, wx, wz) ?? island.topY;
    }
    return [wx, y + py, wz];
  };

  const underVert = (ring, seg) => {
    const t = ring / underRings;
    const theta = (seg / segs) * Math.PI * 2;
    const edge = World.edgeRadius(island, theta);
    const taper = Math.pow(1 - t, 1.35);
    const wobble = 1 + (noise2(theta * 2.3 + seed, t * 4.1 + seed) - 0.5) * 0.55 * t;
    const r = edge * taper * wobble;
    const wx = px + Math.cos(theta) * r + (noise2(seed + t * 7, theta) - 0.5) * t * 3;
    const wz = pz + Math.sin(theta) * r + (noise2(seed - t * 7, theta + 9) - 0.5) * t * 3;
    const y = island.topY - t * depth * (0.85 + 0.3 * noise2(theta * 1.3, seed + t * 3));
    return [wx, y + py, wz];
  };

  const quad = (a, b, c, d) => { positions.push(...a, ...b, ...c, ...a, ...c, ...d); };

  // top surface (center fan + rings)
  const center = topVert(0, 0);
  for (let s = 0; s < segs; s++) {
    const v1 = topVert(1, s), v2 = topVert(1, s + 1);
    positions.push(...center, ...v2, ...v1);
  }
  for (let r = 1; r < topRings; r++) {
    for (let s = 0; s < segs; s++) {
      quad(topVert(r, s), topVert(r, s + 1), topVert(r + 1, s + 1), topVert(r + 1, s));
    }
  }
  // underside
  for (let r = 0; r < underRings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r === 0 ? topVert(topRings, s) : underVert(r, s);
      const b = r === 0 ? topVert(topRings, s + 1) : underVert(r, s + 1);
      quad(a, b, underVert(r + 1, s + 1), underVert(r + 1, s));
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));

  // per-face painterly colors
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  const posAttr = geo.attributes.position;
  const rng = mulberry32(seed * 131 + 7);
  for (let f = 0; f < count / 3; f++) {
    // face centroid
    const cy = (posAttr.getY(f * 3) + posAttr.getY(f * 3 + 1) + posAttr.getY(f * 3 + 2)) / 3;
    const cx = (posAttr.getX(f * 3) + posAttr.getX(f * 3 + 1) + posAttr.getX(f * 3 + 2)) / 3;
    const cz = (posAttr.getZ(f * 3) + posAttr.getZ(f * 3 + 1) + posAttr.getZ(f * 3 + 2)) / 3;
    const topRef = isPlatform ? island.topY : island.topY;
    const rel = topRef - cy;

    if (rel < 0.9 && !bare) {
      // grass: blend two greens with warm patches
      const patch = fbm2(cx * 0.07 + seed, cz * 0.07, 3);
      c.lerpColors(PALETTE.grassA, PALETTE.grassB, patch);
      if (patch > 0.62) c.lerp(PALETTE.grassWarm, (patch - 0.62) * 1.6);
    } else if (rel < 0.9 && bare) {
      // platform top: mossy rock
      c.lerpColors(PALETTE.rockA, PALETTE.grassA, 0.45 + rng() * 0.2);
    } else if (rel < 2.2) {
      c.copy(PALETTE.dirt);
    } else {
      const t = clamp((rel - 2) / (depth * 0.9), 0, 1);
      c.lerpColors(PALETTE.rockA, PALETTE.rockTip, t);
      c.lerp(PALETTE.rockB, noise2(cx * 0.2, cz * 0.2) * 0.5);
    }
    c.offsetHSL(0, 0, (rng() - 0.5) * 0.06);
    for (let v = 0; v < 3; v++) {
      colors[(f * 3 + v) * 3] = c.r;
      colors[(f * 3 + v) * 3 + 1] = c.g;
      colors[(f * 3 + v) * 3 + 2] = c.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeColumnGeometry(rng, h, broken) {
  const geos = [];
  const base = new THREE.CylinderGeometry(0.75, 0.85, 0.5, 8);
  base.translate(0, 0.25, 0);
  geos.push(base);
  const shaft = new THREE.CylinderGeometry(0.5, 0.58, h, 8);
  shaft.translate(0, 0.5 + h / 2, 0);
  // broken top: shear the top vertices at an angle
  if (broken) {
    const pos = shaft.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0.5 + h - 0.01) {
        pos.setY(i, 0.5 + h + pos.getX(i) * randRange(rng, 0.3, 0.7));
      }
    }
    shaft.computeVertexNormals();
  }
  geos.push(shaft);
  if (!broken) {
    const cap = new THREE.BoxGeometry(1.5, 0.42, 1.5);
    cap.translate(0, 0.5 + h + 0.21, 0);
    geos.push(cap);
  }
  const merged = mergeGeometries(geos.map(g => g.toNonIndexed()));
  paintGeometry(merged, PALETTE.stone, PALETTE.stoneDark, rng, 0.18);
  return merged;
}

function makeTree(rng, p) {
  const group = new THREE.Group();
  const h = randRange(rng, 2.6, 4.6);
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, h, 6);
  paintGeometry(trunkGeo.toNonIndexed(), new THREE.Color('#6a4c34'), new THREE.Color('#4a3524'), rng, 0.12);
  const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  const trunk = new THREE.Mesh(trunkGeo.toNonIndexed(), trunkMat);
  paintGeometry(trunk.geometry, new THREE.Color('#6a4c34'), new THREE.Color('#4a3524'), rng, 0.12);
  trunk.position.y = h / 2;
  trunk.castShadow = true;
  group.add(trunk);

  const warm = rng() < 0.3;
  const leafA = warm ? new THREE.Color('#c9903d') : new THREE.Color('#3f7d46');
  const leafB = warm ? new THREE.Color('#e0b04f') : new THREE.Color('#71ad57');
  const blobs = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < blobs; i++) {
    const s = randRange(rng, 1.1, 2.0) * (1 - i * 0.18);
    const geo = new THREE.IcosahedronGeometry(s, 0);
    geo.scale(1, randRange(rng, 0.75, 0.95), 1);
    const g2 = geo.toNonIndexed();
    paintGeometry(g2, leafA, leafB, rng, 0.14);
    const leaf = new THREE.Mesh(g2, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    leaf.position.set(
      (rng() - 0.5) * 1.2,
      h - 0.4 + i * s * 0.85,
      (rng() - 0.5) * 1.2
    );
    leaf.castShadow = true;
    group.add(leaf);
  }
  group.position.copy(p);
  group.rotation.y = rng() * Math.PI * 2;
  group.rotation.z = (rng() - 0.5) * 0.08;
  return group;
}

function makeRock(rng, p) {
  const geo = new THREE.DodecahedronGeometry(randRange(rng, 0.5, 1.5), 0).toNonIndexed();
  geo.scale(1, randRange(rng, 0.55, 0.8), 1);
  paintGeometry(geo, PALETTE.rockA, PALETTE.rockB, rng, 0.12);
  const rock = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  rock.position.copy(p);
  rock.position.y -= 0.15;
  rock.rotation.set(rng() * 0.4, rng() * Math.PI * 2, rng() * 0.4);
  rock.castShadow = true;
  rock.receiveShadow = true;
  return rock;
}

function makeCrystalCluster(rng, p) {
  const group = new THREE.Group();
  const hue = rng() < 0.5 ? 0x7be8ff : 0xc48bff;
  const mat = new THREE.MeshStandardMaterial({
    color: hue, emissive: hue, emissiveIntensity: 1.8,
    roughness: 0.25, metalness: 0.1, flatShading: true,
  });
  const n = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const h = randRange(rng, 0.7, 2.1);
    const geo = new THREE.OctahedronGeometry(h * 0.32, 0);
    geo.scale(1, h / (h * 0.32) * 0.5, 1);
    const c = new THREE.Mesh(geo, mat);
    c.position.set((rng() - 0.5) * 1.4, h * 0.4, (rng() - 0.5) * 1.4);
    c.rotation.set((rng() - 0.5) * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.5);
    c.castShadow = true;
    group.add(c);
  }
  const light = new THREE.PointLight(hue, 6, 12, 2);
  light.position.set(0, 1.2, 0);
  group.add(light);
  group.position.copy(p);
  return { group, mat };
}

function makeGrassTufts(island, rng, count) {
  const blade = new THREE.PlaneGeometry(0.7, 0.55);
  blade.translate(0, 0.26, 0);
  const cross = mergeGeometries([blade, blade.clone().rotateY(Math.PI / 2)]);
  // light blades like the ground beneath them (classic stylized-grass trick)
  const normals = cross.attributes.normal;
  for (let i = 0; i < normals.count; i++) normals.setXYZ(i, 0, 1, 0);
  const tex = makeGrassTexture();
  const mat = new THREE.MeshStandardMaterial({
    map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1,
    color: 0xffffff,
  });
  const inst = new THREE.InstancedMesh(cross, mat, count);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let placed = 0;
  for (let i = 0; i < count * 3 && placed < count; i++) {
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * island.R * 0.93;
    const x = island.x + Math.cos(a) * rr;
    const z = island.z + Math.sin(a) * rr;
    const y = World.islandHeightAt(island, x, z);
    if (y === null) continue;
    dummy.position.set(x, y - 0.02, z);
    dummy.rotation.y = rng() * Math.PI;
    const s = randRange(rng, 0.7, 1.5);
    dummy.scale.set(s, s * randRange(rng, 0.8, 1.3), s);
    dummy.updateMatrix();
    inst.setMatrixAt(placed, dummy.matrix);
    color.lerpColors(PALETTE.grassA, PALETTE.grassB, rng());
    if (rng() < 0.2) color.lerp(PALETTE.grassWarm, 0.6);
    color.offsetHSL(0, 0.05, 0.04);
    inst.setColorAt(placed, color);
    placed++;
  }
  inst.count = placed;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  return inst;
}

// ---- procedural textures ----

let _glowTex = null;
function makeGlowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}

let _cloudTex = null;
function makeCloudTexture() {
  if (_cloudTex) return _cloudTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const ctx = c.getContext('2d');
  const rng = mulberry32(42);
  for (let i = 0; i < 42; i++) {
    const x = 40 + rng() * 176;
    const y = 70 + (rng() - 0.5) * 55;
    const r = 14 + rng() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.10 + rng() * 0.13;
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 160);
  }
  _cloudTex = new THREE.CanvasTexture(c);
  _cloudTex.colorSpace = THREE.SRGBColorSpace;
  return _cloudTex;
}

let _grassTex = null;
function makeGrassTexture() {
  if (_grassTex) return _grassTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const rng = mulberry32(7);
  ctx.clearRect(0, 0, 64, 64);
  for (let i = 0; i < 14; i++) {
    const x = 4 + rng() * 56;
    const w = 2.5 + rng() * 3;
    const h = 28 + rng() * 34;
    const lean = (rng() - 0.5) * 14;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, 64);
    ctx.quadraticCurveTo(x - w / 2 + lean * 0.4, 64 - h * 0.6, x + lean, 64 - h);
    ctx.quadraticCurveTo(x + w / 2 + lean * 0.4, 64 - h * 0.6, x + w / 2, 64);
    ctx.closePath();
    const shade = 200 + Math.floor(rng() * 55);
    ctx.fillStyle = `rgb(${shade - 40},${shade},${shade - 60})`;
    ctx.fill();
  }
  _grassTex = new THREE.CanvasTexture(c);
  _grassTex.colorSpace = THREE.SRGBColorSpace;
  return _grassTex;
}
