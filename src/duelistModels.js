import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Duelist models: third-person player bodies for duel mode, one per class.
// Same flat-shaded painterly style as the enemy models. Every builder returns
//   { group, parts, materials }
// with a shared rig so one animator drives all five:
//   parts.hips  — pelvis pivot (bob / lean / death collapse)
//   parts.torso — chest mesh (pitch lean)
//   parts.head  — head group (aim pitch)
//   parts.armL / parts.armR — shoulder pivots (swing, attack, charge pose)
//   parts.legL / parts.legR — hip pivots (run cycle)
//   parts.weapon — mesh inside armR (attack flourish)
//   parts.cape  — optional, flutters with speed
//   parts.glow  — emissive accent materials (charge/hurt tinting)
// ---------------------------------------------------------------------------

function mat(color, { rough = 0.85, metal = 0, emissive = 0x000000, ei = 1 } = {}, bag) {
  const m = new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei, flatShading: true,
  });
  bag.push(m);
  return m;
}

function shadow(mesh) { mesh.castShadow = true; return mesh; }

// Shared humanoid skeleton. cfg tunes proportions + palette; details(g, parts,
// materials, cfg) bolts on the class-specific gear and must set parts.weapon.
function buildHumanoid(cfg, details) {
  const materials = [];
  const g = new THREE.Group();

  const hips = new THREE.Group();
  hips.position.y = 0.98;
  g.add(hips);

  // legs pivot at the hip so a run cycle is a simple rotation.x swing
  const mkLeg = (side) => {
    const leg = new THREE.Group();
    const thigh = shadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.13 * cfg.bulk, 0.11 * cfg.bulk, 0.5, 6),
      mat(cfg.pants, {}, materials)
    ));
    thigh.position.y = -0.25;
    leg.add(thigh);
    const boot = shadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.11 * cfg.bulk, 0.14 * cfg.bulk, 0.42, 6),
      mat(cfg.boots, { rough: 0.7 }, materials)
    ));
    boot.position.y = -0.72;
    leg.add(boot);
    const toe = new THREE.Mesh(
      new THREE.BoxGeometry(0.16 * cfg.bulk, 0.1, 0.22),
      mat(cfg.boots, { rough: 0.7 }, materials)
    );
    toe.position.set(0, -0.9, 0.08);
    leg.add(toe);
    leg.position.set(side * 0.16 * cfg.bulk, 0, 0);
    hips.add(leg);
    return leg;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  // pelvis block
  const pelvis = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22 * cfg.bulk, 0.19 * cfg.bulk, 0.22, 6),
    mat(cfg.belt, { rough: 0.6 }, materials)
  );
  hips.add(pelvis);

  // torso leans from just above the pelvis
  const chest = new THREE.Group();
  chest.position.y = 0.12;
  hips.add(chest);
  const torso = shadow(new THREE.Mesh(
    new THREE.CylinderGeometry(0.26 * cfg.bulk, 0.2 * cfg.bulk, 0.62, 7),
    mat(cfg.coat, {}, materials)
  ));
  torso.position.y = 0.36;
  chest.add(torso);
  // chest emblem: class-colored emissive diamond
  const emblemMat = mat(cfg.accent, { emissive: cfg.accent, ei: 1.8, rough: 0.3 }, materials);
  const emblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.085, 0), emblemMat);
  emblem.scale.z = 0.45;
  emblem.position.set(0, 0.44, 0.24 * cfg.bulk);
  chest.add(emblem);

  // shoulders + arms
  const mkArm = (side) => {
    const arm = new THREE.Group();
    const pauldron = shadow(new THREE.Mesh(
      new THREE.SphereGeometry(0.14 * cfg.bulk, 6, 5),
      mat(cfg.pads, { rough: 0.55, metal: cfg.metal }, materials)
    ));
    pauldron.scale.set(1.15, 0.8, 1);
    arm.add(pauldron);
    const upper = shadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.09 * cfg.bulk, 0.08 * cfg.bulk, 0.42, 6),
      mat(cfg.coat, {}, materials)
    ));
    upper.position.y = -0.24;
    arm.add(upper);
    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(0.09 * cfg.bulk, 6, 5),
      mat(cfg.skin, { rough: 0.9 }, materials)
    );
    hand.position.y = -0.5;
    arm.add(hand);
    arm.position.set(side * 0.34 * cfg.bulk, 0.62, 0);
    chest.add(arm);
    return arm;
  };
  const armL = mkArm(-1), armR = mkArm(1);

  // head
  const head = new THREE.Group();
  head.position.y = 0.82;
  chest.add(head);
  const skull = shadow(new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 7, 6),
    mat(cfg.skin, { rough: 0.9 }, materials)
  ));
  skull.scale.y = 1.1;
  head.add(skull);
  const eyeMat = mat(cfg.accent, { emissive: cfg.accent, ei: 3, rough: 0.3 }, materials);
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 5), eyeMat);
  eyeL.position.set(-0.06, 0.03, 0.15);
  head.add(eyeL);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.06; head.add(eyeR);

  const parts = {
    hips, chest, torso, head, armL, armR, legL, legR,
    emblem, glow: [emblemMat, eyeMat], weapon: null, cape: null,
  };
  details(g, parts, materials, cfg);
  return { group: g, parts, materials };
}

function mkCape(cfg, materials, len = 1.1) {
  const cape = shadow(new THREE.Mesh(
    new THREE.ConeGeometry(0.34, len, 5, 1, true),
    mat(cfg.cape, { rough: 1 }, materials)
  ));
  cape.position.set(0, 0.55 - len / 2, -0.24);
  cape.rotation.x = 0.16;
  return cape;
}

// ---- Arcane Mage: robed, pointed hat, orb-tipped staff ----
function buildMage() {
  return buildHumanoid({
    bulk: 0.92, metal: 0,
    coat: 0x2f4a78, pants: 0x263a5e, boots: 0x1c2a45, belt: 0x3d5a8f,
    pads: 0x3d5a8f, skin: 0xd9b48f, cape: 0x243a63, accent: 0x66ccff,
  }, (g, parts, materials, cfg) => {
    // robe skirt over the legs
    const skirt = shadow(new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 0.95, 7, 1, true),
      mat(cfg.coat, {}, materials)
    ));
    skirt.position.y = 0.62;
    g.add(skirt);
    // wizard hat
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.05, 8), mat(0x223757, {}, materials));
    brim.position.y = 0.14;
    parts.head.add(brim);
    const cone = shadow(new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.5, 8), mat(0x223757, {}, materials)));
    cone.position.y = 0.38;
    cone.rotation.z = 0.14;
    parts.head.add(cone);
    // staff with floating orb (weapon, in right hand)
    const staff = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.5, 6), mat(0x5e4630, { rough: 1 }, materials));
    staff.add(shaft);
    const orbMat = mat(0x66ccff, { emissive: 0x44bbff, ei: 2.4, rough: 0.2 }, materials);
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), orbMat);
    orb.position.y = 0.85;
    staff.add(orb);
    parts.glow.push(orbMat);
    staff.position.set(0, -0.5, 0.1);
    staff.rotation.x = -0.25;
    parts.armR.add(staff);
    parts.weapon = staff;
    parts.cape = mkCape(cfg, materials);
    parts.chest.add(parts.cape);
  });
}

// ---- Iron Brawler: broad, oversized glowing gauntlets ----
function buildBrawler() {
  return buildHumanoid({
    bulk: 1.25, metal: 0.2,
    coat: 0x7a4526, pants: 0x54331f, boots: 0x3a2316, belt: 0x8f5a2e,
    pads: 0x995f2e, skin: 0xc99a6d, cape: 0x5e3a22, accent: 0xff8833,
  }, (g, parts, materials) => {
    // both fists get huge plated gauntlets
    for (const [arm, side] of [[parts.armL, -1], [parts.armR, 1]]) {
      const fist = shadow(new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.2, 0),
        mat(0x8a5a30, { metal: 0.5, rough: 0.45 }, materials)
      ));
      fist.position.y = -0.55;
      arm.add(fist);
      const knuckle = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.08, 0.1),
        mat(0xff8833, { emissive: 0xff6611, ei: 1.6 }, materials)
      );
      knuckle.position.set(side * 0.02, -0.58, 0.16);
      arm.add(knuckle);
      if (side === 1) parts.weapon = fist;
    }
    // headband + jaw guard instead of a helmet
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 8), mat(0xff8833, { emissive: 0xcc5511, ei: 0.8 }, materials));
    band.position.y = 0.1;
    parts.head.add(band);
    // heavy spine plate
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.12), mat(0x995f2e, { metal: 0.4, rough: 0.5 }, materials));
    plate.position.set(0, 0.38, -0.26);
    parts.chest.add(plate);
  });
}

// ---- Storm Reaver: lean spearfighter, storm-blue, long cape ----
function buildReaver() {
  return buildHumanoid({
    bulk: 1.0, metal: 0.35,
    coat: 0x2e5e66, pants: 0x224850, boots: 0x18333a, belt: 0x3a747e,
    pads: 0x3a747e, skin: 0xd4a982, cape: 0x1d444d, accent: 0x55ffcc,
  }, (g, parts, materials, cfg) => {
    // crested light helm
    const helm = shadow(new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.28, 6), mat(0x3a747e, { metal: 0.5, rough: 0.4 }, materials)));
    helm.position.y = 0.16;
    parts.head.add(helm);
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.3), mat(0x55ffcc, { emissive: 0x33ddaa, ei: 1.6 }, materials));
    crest.position.y = 0.3;
    parts.head.add(crest);
    // the spear: long shaft + storm-lit head
    const spear = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 6), mat(0x4a3a28, { rough: 1 }, materials));
    spear.add(shaft);
    const tipMat = mat(0xbfeee6, { emissive: 0x55ffcc, ei: 1.8, metal: 0.6, rough: 0.3 }, materials);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.42, 4), tipMat);
    tip.position.y = 1.12;
    tip.scale.z = 0.4;
    spear.add(tip);
    parts.glow.push(tipMat);
    spear.position.set(0, -0.5, 0.08);
    spear.rotation.x = -0.35;
    parts.armR.add(spear);
    parts.weapon = spear;
    parts.cape = mkCape(cfg, materials, 1.25);
    parts.chest.add(parts.cape);
  });
}

// ---- Stone Warden: heavy armor, tower greatsword + emblem shield ----
function buildWarden() {
  return buildHumanoid({
    bulk: 1.35, metal: 0.55,
    coat: 0x6e6552, pants: 0x544c3e, boots: 0x3a352c, belt: 0x8a7a5a,
    pads: 0x8f8163, skin: 0xc9a075, cape: 0x4a4436, accent: 0xffd76a,
  }, (g, parts, materials, cfg) => {
    // full helm with slit visor
    const helm = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.3, 6), mat(0x8f8163, { metal: 0.6, rough: 0.4 }, materials)));
    helm.position.y = 0.08;
    parts.head.add(helm);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.045, 0.05), mat(0xffd76a, { emissive: 0xffc23a, ei: 2.6 }, materials));
    visor.position.set(0, 0.05, 0.18);
    parts.head.add(visor);
    // greatsword
    const sword = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 6), mat(0x3a352c, { rough: 0.8 }, materials));
    sword.add(grip);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.07), mat(0x8a7a5a, { metal: 0.6, rough: 0.4 }, materials));
    guard.position.y = 0.17;
    sword.add(guard);
    const bladeMat = mat(0xd9cba8, { metal: 0.7, rough: 0.3 }, materials);
    const blade = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.15, 0.035), bladeMat));
    blade.position.y = 0.76;
    sword.add(blade);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.15, 0.05), mat(0xffd76a, { emissive: 0xdd9922, ei: 1.4 }, materials));
    edge.position.set(0.07, 0.76, 0);
    sword.add(edge);
    sword.position.set(0, -0.5, 0.08);
    sword.rotation.x = -0.3;
    parts.armR.add(sword);
    parts.weapon = sword;
    // shield on the left forearm
    const shield = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.06, 6), mat(0x7a6e52, { metal: 0.5, rough: 0.5 }, materials)));
    shield.rotation.z = Math.PI / 2;
    shield.position.set(-0.1, -0.35, 0);
    parts.armL.add(shield);
    const boss = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), mat(0xffd76a, { emissive: 0xffc23a, ei: 1.8 }, materials));
    boss.scale.x = 0.5;
    boss.position.set(-0.15, -0.35, 0);
    parts.armL.add(boss);
    parts.cape = mkCape(cfg, materials, 1.2);
    parts.chest.add(parts.cape);
  });
}

// ---- Void Assassin: slim, hooded, twin daggers, void shards ----
function buildAssassin() {
  return buildHumanoid({
    bulk: 0.85, metal: 0.1,
    coat: 0x2a2140, pants: 0x211a33, boots: 0x171226, belt: 0x3a2d5c,
    pads: 0x3a2d5c, skin: 0xcfa88a, cape: 0x1d1733, accent: 0xbb55ff,
  }, (g, parts, materials, cfg) => {
    // deep hood over the head
    const hood = shadow(new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.42, 7), mat(0x241c3a, {}, materials)));
    hood.position.y = 0.12;
    hood.rotation.x = 0.2;
    parts.head.add(hood);
    // half-mask
    const maskM = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.06), mat(0x171226, {}, materials));
    maskM.position.set(0, -0.05, 0.15);
    parts.head.add(maskM);
    // twin daggers, one per hand
    const mkDagger = (arm, side) => {
      const dagger = new THREE.Group();
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 5), mat(0x171226, {}, materials));
      dagger.add(grip);
      const bladeMat = mat(0xd8c8ff, { emissive: 0xbb55ff, ei: 1.2, metal: 0.6, rough: 0.3 }, materials);
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.5, 4), bladeMat);
      blade.position.y = 0.34;
      blade.scale.z = 0.35;
      dagger.add(blade);
      dagger.position.set(0, -0.52, 0.06);
      dagger.rotation.x = -0.5;
      arm.add(dagger);
      if (side === 1) { parts.weapon = dagger; parts.glow.push(bladeMat); }
      return dagger;
    };
    mkDagger(parts.armL, -1);
    mkDagger(parts.armR, 1);
    // orbiting void shards
    const shards = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const shard = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.07, 0),
        mat(0x7a3fd9, { emissive: 0x6a2fd0, ei: 1.6, rough: 0.3 }, materials)
      );
      shard.scale.y = 2.0;
      const a = (i / 3) * Math.PI * 2;
      shard.position.set(Math.cos(a) * 0.5, 0.3 + (i % 2) * 0.25, Math.sin(a) * 0.5);
      shards.add(shard);
    }
    parts.chest.add(shards);
    parts.shards = shards;
    parts.cape = mkCape(cfg, materials, 1.0);
    parts.chest.add(parts.cape);
  });
}

export const DUELIST_BUILDERS = {
  mage: buildMage,
  brawler: buildBrawler,
  reaver: buildReaver,
  warden: buildWarden,
  assassin: buildAssassin,
};
