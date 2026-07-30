import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------------------------------------------------------------------------
// Preloaded GLB player-character models (sky-champions pack). Rigged as named
// TRS nodes (no skinning), so the existing procedural animators can grab and
// rotate arms/legs/weapons directly.
//
// Used two ways:
//   - buildChampionThirdPerson(classId): full body for duel/ffa opponents,
//     exposing the same parts interface duelistModels.js builders return.
//   - buildChampionViewRig(classId): first-person arms + weapon extracted
//     from the same model, matching the viewmodels.js rig interface.
// ---------------------------------------------------------------------------

// Master switch: set to false to instantly revert players to the old
// procedural models (duelistModels.js and viewmodels.js are still intact).
export const USE_GLB_CHAMPIONS = false;

const FILES = {
  mage:     'arcane-mage',
  brawler:  'iron-brawler',
  reaver:   'storm-reaver',
  warden:   'warden',
  assassin: 'shadow-assassin',
};

// node-name prefix per class inside the GLB
const PREFIX = { mage: 'a', brawler: 'br', reaver: 'sv', warden: 'wd', assassin: 'as' };
const WEAPON = { mage: 'staff', brawler: 'gauntletR', reaver: 'spear', warden: 'greatsword', assassin: 'daggerR' };
const TINT   = { mage: 0x66ccff, brawler: 0xff8833, reaver: 0x55ddff, warden: 0xffd76a, assassin: 0x9a5fff };
// first-person cast-origin node (rig.focus)
const FOCUS  = { mage: 'orb', brawler: 'gauntletR', reaver: 'spearTip', warden: 'gsBlade', assassin: 'daggerR' };
// hand/fist node per class ([right, left]) — used to center the FP rig
const HANDS = {
  mage:     ['aHandR', 'aHandL'],
  brawler:  ['gauntletR', 'gauntletL'],
  reaver:   ['svHandR', 'svHandL'],
  warden:   ['wdFistR', 'wdFistL'],
  assassin: ['asHandR', 'asHandL'],
};

export const CHAMPION_ASSETS = {};

export function preloadChampionModels() {
  if (!USE_GLB_CHAMPIONS) return Promise.resolve();   // old models: skip the downloads
  const loader = new GLTFLoader();
  return Promise.all(Object.entries(FILES).map(([classId, name]) =>
    new Promise((resolve) => {
      loader.load(`assets/champions/${name}.glb`, (gltf) => {
        const scene = gltf.scene;
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(scene);
        scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        CHAMPION_ASSETS[classId] = {
          scene,
          clips: gltf.animations,
          size: box.getSize(new THREE.Vector3()),
          center: box.getCenter(new THREE.Vector3()),
          minY: box.min.y,
        };
        resolve();
      }, undefined, (err) => {
        console.warn(`[championAssets] ${name}.glb failed to load — using procedural model`, err);
        resolve();
      });
    })
  ));
}

function cloneWithMaterials(asset) {
  const inner = asset.scene.clone(true);
  const materials = [];
  inner.traverse((o) => {
    if (o.isMesh) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.emissive) materials.push(m);
      }
    }
  });
  return { inner, materials };
}

// ---- third person: full body, parts mapped for the duelOpponent animator ----
export function buildChampionThirdPerson(classId, height = 1.9) {
  if (!USE_GLB_CHAMPIONS) return null;
  const asset = CHAMPION_ASSETS[classId];
  if (!asset) return null;
  const { inner, materials } = cloneWithMaterials(asset);
  const p = PREFIX[classId];
  const find = (n) => inner.getObjectByName(n) || null;

  const chest = find(`${p}Torso`);
  const head = find(`${p}Head`);
  const armL = find(`${p}ArmL`);
  const armR = find(`${p}ArmR`);
  if (!chest || !head || !armL || !armR) return null;   // unexpected rig: fall back

  const scale = height / Math.max(0.001, asset.size.y);
  inner.scale.setScalar(scale);
  // the animator treats hips as a pivot at y=0.98 (death crumple, run bob),
  // so wrap the model with its feet hanging 0.98 below the pivot
  const hips = new THREE.Group();
  hips.position.y = 0.98;
  inner.position.set(-asset.center.x * scale, -asset.minY * scale - 0.98, -asset.center.z * scale);
  hips.add(inner);
  const group = new THREE.Group();
  group.add(hips);

  // mage has a robe skirt instead of legs — give the animator harmless dummies
  const legL = find(`${p}LegL`) ?? new THREE.Group();
  const legR = find(`${p}LegR`) ?? new THREE.Group();

  const parts = {
    hips, chest, head, armL, armR, legL, legR,
    torso: chest,
    weapon: find(WEAPON[classId]),
    cape: find(`${p}Cape`),
    shards: find('voidShards'),
    emblem: find('beltGem') ?? find('wdEmblem') ?? find('svGem') ?? null,
    glow: materials.filter((m) => m.emissive.getHex() !== 0),
  };
  return { group, parts, materials, usesGlb: true };
}

// ---- first person: arm + weapon subtrees pulled off the model ----
// Each arm is rotated to reach forward and auto-centered so the hand sits at
// the rig origin (viewmodels.js then places the rig bottom-right of camera).
function extractArm(inner, armName, handName, { raise = -1.35, side = 0, scale = 1.15 } = {}) {
  const arm = inner.getObjectByName(armName);
  if (!arm) return null;
  const holder = new THREE.Group();
  holder.add(arm);
  arm.rotation.x = raise;
  arm.rotation.z = side * -0.12;
  holder.updateMatrixWorld(true);
  const hand = inner.getObjectByName(handName) ?? arm;
  const hp = hand.getWorldPosition(new THREE.Vector3());
  const ap = arm.getWorldPosition(new THREE.Vector3());
  // shift so the hand lands at the holder origin
  arm.position.sub(hp.sub(ap));
  holder.scale.setScalar(scale);
  holder.position.x = side * 0.28;
  return holder;
}

export function buildChampionViewRig(classId) {
  if (!USE_GLB_CHAMPIONS) return null;
  const asset = CHAMPION_ASSETS[classId];
  if (!asset) return null;
  const { inner, materials } = cloneWithMaterials(asset);
  inner.updateMatrixWorld(true);
  const p = PREFIX[classId];
  const g = new THREE.Group();

  const dual = classId === 'brawler' || classId === 'assassin' || classId === 'warden';
  const [handR, handL] = HANDS[classId];
  const right = extractArm(inner, `${p}ArmR`, handR, { side: dual ? 1 : 0 });
  const left = dual ? extractArm(inner, `${p}ArmL`, handL, { side: -1 }) : null;
  if (!right) return null;
  g.add(right);
  if (left) g.add(left);

  // viewmodel is close to the camera and lit by a small fill light; lift the
  // darkest materials a touch so sleeves/gear stay readable
  for (const m of materials) {
    if (m.emissive.getHex() === 0) m.emissive.copy(m.color).multiplyScalar(0.25);
  }

  const focus = g.getObjectByName(FOCUS[classId]) ?? right;
  return { group: g, focus, tint: TINT[classId], right, left: left ?? undefined, usesGlb: true };
}
