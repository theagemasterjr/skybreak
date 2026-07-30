import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------------------------------------------------------------------------
// Preloaded GLB enemy models (lowpoly creature pack). Each file carries two
// clips: 'idle' and 'move'. Types not listed here (wraith, swarmling,
// sentinel) keep their procedural builders from enemyModels.js.
// ---------------------------------------------------------------------------

// Master switch: set to false to instantly revert every enemy to the old
// procedural models (the builders in enemyModels.js are all still intact).
export const USE_GLB_ENEMIES = true;

const FILES = {
  rusher:   'shadow-reaper',
  sniper:   'hex-mage',
  flyer:    'gloom-bat',
  blinker:  'void-wraith',
  shielder: 'rune-guardian',
  bomber:   'ember-bomb',
  golem:    'rock-golem',
  knight:   'crystal-knight',
};

// type -> { scene, clips, size, minY, center } once loaded
export const ENEMY_ASSETS = {};

export function preloadEnemyModels() {
  const loader = new GLTFLoader();
  return Promise.all(Object.entries(FILES).map(([type, name]) =>
    new Promise((resolve) => {
      loader.load(`assets/enemies/${name}.glb`, (gltf) => {
        const scene = gltf.scene;
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(scene);
        scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        ENEMY_ASSETS[type] = {
          scene,
          clips: gltf.animations,
          size: box.getSize(new THREE.Vector3()),
          center: box.getCenter(new THREE.Vector3()),
          minY: box.min.y,
        };
        resolve();
      }, undefined, (err) => {
        console.warn(`[enemyAssets] ${name}.glb failed to load — using procedural model`, err);
        resolve();
      });
    })
  ));
}

// Build a per-enemy instance: an outer group (safe for the death-shrink anim
// to scale) holding the model normalized so feet sit at y=0 and it spans the
// type's collision height, facing +Z.
export function buildGlbInstance(type, def) {
  if (!USE_GLB_ENEMIES) return null;
  const asset = ENEMY_ASSETS[type];
  if (!asset) return null;
  const inner = asset.scene.clone(true);
  const materials = [];
  inner.traverse((o) => {
    if (o.isMesh) {
      // per-instance materials so damage-flash / freeze / poison tints
      // don't bleed across enemies of the same type
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.emissive) materials.push(m);
      }
    }
  });
  const scale = def.height / Math.max(0.001, asset.size.y);
  inner.scale.setScalar(scale);
  inner.position.set(-asset.center.x * scale, -asset.minY * scale, -asset.center.z * scale);
  const group = new THREE.Group();
  group.add(inner);

  const mixer = new THREE.AnimationMixer(inner);
  const idleClip = THREE.AnimationClip.findByName(asset.clips, 'idle') ?? asset.clips[0];
  const moveClip = THREE.AnimationClip.findByName(asset.clips, 'move') ?? asset.clips[1] ?? idleClip;
  const idle = mixer.clipAction(idleClip);
  const move = mixer.clipAction(moveClip);
  idle.play();
  move.play();
  move.setEffectiveWeight(0);
  // desync so a wave of the same type doesn't animate in lockstep
  mixer.setTime(Math.random() * idleClip.duration);

  return { group, inner, materials, mixer, idle, move, scale };
}
