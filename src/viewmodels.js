import * as THREE from 'three';
import { damp, clamp } from './utils.js';
import { buildChampionViewRig } from './championAssets.js';
import { buildDieMesh } from './gambler.js';

// ---------------------------------------------------------------------------
// ViewModel: the first-person hands/weapon rig attached to the camera.
// Each class gets a distinct rig; shared sway/bob/recoil animation.
// ---------------------------------------------------------------------------

function mat(color, { rough = 0.8, metal = 0, emissive = 0x000000, ei = 1 } = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei, flatShading: true,
  });
}

const SKIN = 0xd9a066;
const SLEEVE = { mage: 0x4a3f7a, brawler: 0x8a2f2a, reaver: 0x274a56, sorcerer: 0x1b1e2e, assassin: 0x2a2a33, gambler: 0x1d5c3f };

function makeHand(sleeveColor) {
  const g = new THREE.Group();
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.11, 0.3, 8), mat(sleeveColor));
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.z = 0.14;
  g.add(sleeve);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), mat(SKIN, { rough: 0.9 }));
  hand.scale.set(1, 0.85, 1.25);
  g.add(hand);
  return g;
}

function buildMageRig() {
  const g = new THREE.Group();
  const hand = makeHand(SLEEVE.mage);
  hand.position.set(0, 0, 0);
  g.add(hand);
  // staff angled forward-up
  const staff = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.035, 1.5, 7), mat(0x6a4c34));
  staff.add(shaft);
  const headWrap = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.02, 6, 12), mat(0xc9a227, { metal: 0.7, rough: 0.4 }));
  headWrap.position.y = 0.66;
  headWrap.rotation.x = Math.PI / 2;
  staff.add(headWrap);
  const orb = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.09, 1),
    mat(0x9be8ff, { emissive: 0x66ccff, ei: 2.4, rough: 0.2 })
  );
  orb.position.y = 0.82;
  staff.add(orb);
  staff.rotation.x = 0.5;
  staff.rotation.z = -0.1;
  staff.position.set(0.02, 0.05, -0.06);
  g.add(staff);
  return { group: g, focus: orb, tint: 0x66ccff };
}

function buildBrawlerRig() {
  const g = new THREE.Group();
  // two big gauntlets
  const mk = (side) => {
    const fist = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.32, 8), mat(SLEEVE.brawler));
    sleeve.rotation.x = Math.PI / 2;
    sleeve.position.z = 0.18;
    fist.add(sleeve);
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.17, 0.24), mat(0xc9781f, { metal: 0.55, rough: 0.45 }));
    fist.add(glove);
    const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.06, 0.07), mat(0xffcf5e, { metal: 0.8, rough: 0.3, emissive: 0xff7722, ei: 0.6 }));
    knuckle.position.set(0, 0.05, -0.1);
    fist.add(knuckle);
    fist.position.x = side * 0.28;
    return fist;
  };
  const right = mk(1), left = mk(-1);
  g.add(right); g.add(left);
  return { group: g, focus: right, tint: 0xff8833, right, left };
}

function buildReaverRig() {
  const g = new THREE.Group();
  const hand = makeHand(SLEEVE.reaver);
  g.add(hand);
  const glaive = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.2, 7), mat(0x3a4e58, { metal: 0.4, rough: 0.5 }));
  glaive.add(shaft);
  const blade = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.5, 4), mat(0xbfe8ff, { metal: 0.6, rough: 0.25, emissive: 0x44ccff, ei: 1.6 }));
  blade.scale.z = 0.3;
  blade.position.y = 0.8;
  glaive.add(blade);
  const prong1 = blade.clone(); prong1.scale.setScalar(0.45); prong1.scale.z = 0.15;
  prong1.position.set(0.09, 0.68, 0); prong1.rotation.z = -0.35; glaive.add(prong1);
  const prong2 = prong1.clone(); prong2.position.x = -0.09; prong2.rotation.z = 0.35; glaive.add(prong2);
  glaive.rotation.x = 0.55;
  glaive.position.set(0.02, 0.08, -0.1);
  g.add(glaive);
  return { group: g, focus: blade, tint: 0x55ddff };
}

function buildSorcererRig() {
  const g = new THREE.Group();
  // two bare hands in dark uniform sleeves; right palm carries a faint
  // cursed-energy glow that doubles as the cast origin
  const mk = (side) => {
    const hand = makeHand(SLEEVE.sorcerer);
    hand.position.x = side * 0.28;
    hand.rotation.z = side * -0.1;
    return hand;
  };
  const right = mk(1), left = mk(-1);
  const spark = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.055, 1),
    mat(0xd8c2ff, { emissive: 0x8f5bff, ei: 2.6, rough: 0.2 })
  );
  spark.position.set(0, 0.02, -0.1);
  right.add(spark);
  g.add(right); g.add(left);
  return { group: g, focus: spark, tint: 0x8f5bff, right, left };
}

function buildAssassinRig() {
  const g = new THREE.Group();
  const mk = (side) => {
    const hand = makeHand(SLEEVE.assassin);
    const dagger = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.16, 6), mat(0x333340));
    dagger.add(grip);
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.5, 4), mat(0x9a86c9, { metal: 0.7, rough: 0.3, emissive: 0x6a3fd9, ei: 0.9 }));
    blade.scale.z = 0.35;
    blade.position.y = 0.34;
    dagger.add(blade);
    dagger.rotation.x = 0.85;
    hand.add(dagger);
    hand.position.x = side * 0.3;
    hand.rotation.z = side * -0.15;
    return hand;
  };
  const right = mk(1), left = mk(-1);
  g.add(right); g.add(left);
  return { group: g, focus: right, tint: 0x9a5fff, right, left };
}

function buildGamblerRig() {
  const g = new THREE.Group();
  // right hand holds the lucky die up like a showman
  const hand = makeHand(SLEEVE.gambler);
  const die = buildDieMesh(0.17);
  die.position.set(0, 0.12, -0.04);
  die.rotation.set(0.5, 0.65, 0.1);
  hand.add(die);
  // gold cufflink — a little flash on the wrist
  const cuff = new THREE.Mesh(
    new THREE.TorusGeometry(0.095, 0.018, 6, 12),
    mat(0xf2c14e, { metal: 0.8, rough: 0.3, emissive: 0xaa7716, ei: 0.5 })
  );
  cuff.rotation.x = Math.PI / 2;
  cuff.position.z = 0.05;
  hand.add(cuff);
  g.add(hand);
  return { group: g, focus: die, tint: 0xffd24a };
}

const BUILDERS = {
  mage: buildMageRig,
  brawler: buildBrawlerRig,
  reaver: buildReaverRig,
  sorcerer: buildSorcererRig,
  assassin: buildAssassinRig,
  gambler: buildGamblerRig,
};

export class ViewModel {
  constructor(camera, classId) {
    this.camera = camera;
    // GLB champion arms if preloaded, old procedural rig otherwise
    const built = buildChampionViewRig(classId) ?? BUILDERS[classId]();
    this.rig = built;
    this.group = new THREE.Group();
    this.group.add(built.group);
    this.basePos = new THREE.Vector3(0.42, -0.42, -0.78);
    this.group.position.copy(this.basePos);
    camera.add(this.group);

    // rig lighting: viewmodel is a camera child, so scene lights hit it oddly;
    // a small dedicated light keeps it readable
    const fill = new THREE.PointLight(0xffe0b8, 1.4, 3.5, 1.8);
    fill.position.set(0.2, 0.4, 0.3);
    camera.add(fill);
    this._fill = fill;

    this.swayX = 0; this.swayY = 0;
    this.recoil = 0;          // pushes rig back+up
    this.altAnim = 0;         // generic secondary animation (punch alternation etc.)
    this.punchSide = 1;
    this.bobPhase = 0;
    this.raiseT = 0;          // weapon raise on spawn
  }

  trigger(kind = 'cast') {
    if (kind === 'cast') this.recoil = Math.min(1, this.recoil + 0.55);
    if (kind === 'heavy') this.recoil = Math.min(1.4, this.recoil + 1.1);
    if (kind === 'punch') {
      this.punchSide *= -1;
      this.altAnim = 1;
      this.recoil = Math.min(1, this.recoil + 0.25);
    }
  }

  update(dt, time, player, lookDX, lookDY) {
    // sway opposite to look
    this.swayX = damp(this.swayX, clamp(-lookDX * 0.0009, -0.06, 0.06), 10, dt);
    this.swayY = damp(this.swayY, clamp(lookDY * 0.0009, -0.05, 0.05), 10, dt);
    // bob with movement
    const hSpeed = Math.hypot(player.vel.x, player.vel.z);
    const moving = player.grounded && hSpeed > 1.5;
    if (moving) this.bobPhase += dt * (6 + hSpeed * 0.3);
    const bobY = Math.sin(this.bobPhase * 2) * 0.012 * (moving ? 1 : 0.3);
    const bobX = Math.cos(this.bobPhase) * 0.008 * (moving ? 1 : 0.3);
    // idle breathe
    const breathe = Math.sin(time * 1.7) * 0.006;
    // recoil spring
    this.recoil = damp(this.recoil, 0, 9, dt);
    this.altAnim = damp(this.altAnim, 0, 8, dt);
    this.raiseT = Math.min(1, this.raiseT + dt * 2.2);
    const raise = (1 - this.raiseT) * -0.4;

    this.group.position.set(
      this.basePos.x + this.swayX + bobX,
      this.basePos.y + this.swayY + bobY + breathe - this.recoil * 0.05 + raise,
      this.basePos.z + this.recoil * 0.12
    );
    this.group.rotation.set(
      this.recoil * 0.22 + this.swayY * 0.6,
      this.swayX * 0.8,
      this.swayX * 0.4
    );

    // punch animation for dual-fist rigs
    if (this.rig.right && this.rig.left) {
      const punch = this.altAnim;
      const active = this.punchSide > 0 ? this.rig.right : this.rig.left;
      const rest = this.punchSide > 0 ? this.rig.left : this.rig.right;
      active.position.z = -punch * 0.5;
      rest.position.z = damp(rest.position.z, 0, 12, dt);
    }

    // falling: rig drifts up slightly
    if (!player.grounded) {
      this.group.position.y += clamp(player.vel.y * 0.004, -0.03, 0.05);
    }
  }

  dispose() {
    this.camera.remove(this.group);
    this.camera.remove(this._fill);
    this.group.traverse((o) => {
      // GLB geometry is shared with the preloaded template — never dispose it
      if (o.geometry && !this.rig.usesGlb) o.geometry.dispose();
      if (o.material) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
  }
}
