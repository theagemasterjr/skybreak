import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Enemy model builders. Multi-part stylized figures matching the world's
// flat-shaded painterly look. Every builder returns:
//   { group, parts: {...animatable refs}, materials: [all mats for tinting] }
// ---------------------------------------------------------------------------

function mat(color, { rough = 0.85, metal = 0, emissive = 0x000000, ei = 1 } = {}, bag) {
  const m = new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei, flatShading: true,
  });
  bag.push(m);
  return m;
}

function eyeMesh(color, size, bag) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(size, 6, 5),
    mat(color, { emissive: color, ei: 3, rough: 0.3 }, bag)
  );
  return m;
}

// ---- 1. Rusher: "Blade Husk" — hooded wraith with two floating blades ----
export function buildRusher() {
  const materials = [];
  const g = new THREE.Group();
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.5, 7), mat(0x3a4448, {}, materials));
  robe.position.y = 0.75;
  robe.castShadow = true;
  g.add(robe);
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.34, 7, 6), mat(0x2c3438, {}, materials));
  chest.position.y = 1.35;
  chest.scale.set(1, 0.85, 0.8);
  g.add(chest);
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.62, 7), mat(0x232a2d, {}, materials));
  hood.position.y = 1.78;
  g.add(hood);
  const eyeL = eyeMesh(0xff7a2a, 0.055, materials);
  eyeL.position.set(-0.09, 1.62, 0.24);
  g.add(eyeL);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.09; g.add(eyeR);

  const mkBlade = (side) => {
    const arm = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.95, 4), mat(0x8a97a0, { metal: 0.7, rough: 0.35, emissive: 0xff5522, ei: 0.25 }, materials));
    blade.scale.z = 0.28;
    blade.rotation.x = Math.PI / 2;   // point forward
    blade.position.z = 0.35;
    arm.add(blade);
    arm.position.set(side * 0.62, 1.15, 0.1);
    g.add(arm);
    return arm;
  };
  const bladeL = mkBlade(-1), bladeR = mkBlade(1);
  return { group: g, parts: { robe, bladeL, bladeR, eyes: [eyeL, eyeR] }, materials };
}

// ---- 2. Sniper: "Hex Caster" — tall robed caster with floating orb ----
export function buildSniper() {
  const materials = [];
  const g = new THREE.Group();
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.9, 8), mat(0x4a2f63, {}, materials));
  robe.position.y = 0.95;
  robe.castShadow = true;
  g.add(robe);
  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.36, 7, 6), mat(0x5b3a78, {}, materials));
  shoulders.position.y = 1.75;
  shoulders.scale.set(1.15, 0.6, 0.9);
  g.add(shoulders);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 7, 6), mat(0x2c1f3a, {}, materials));
  head.position.y = 2.02;
  g.add(head);
  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.06, 8), mat(0x3a2750, {}, materials));
  hatBrim.position.y = 2.16;
  g.add(hatBrim);
  const hatTop = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.55, 8), mat(0x3a2750, {}, materials));
  hatTop.position.y = 2.45;
  hatTop.rotation.z = 0.12;
  g.add(hatTop);
  const eyeL = eyeMesh(0xe055ff, 0.05, materials);
  eyeL.position.set(-0.08, 2.03, 0.19);
  g.add(eyeL);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.08; g.add(eyeR);
  const orb = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.16, 1),
    mat(0xe055ff, { emissive: 0xc93aff, ei: 2, rough: 0.2 }, materials)
  );
  orb.position.set(0, 1.5, 0.55);
  g.add(orb);
  return { group: g, parts: { robe, orb, hatTop }, materials };
}

// ---- 3. Flyer: "Sky Stinger" — winged darting creature ----
export function buildFlyer() {
  const materials = [];
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), mat(0x2f6a72, {}, materials));
  body.scale.set(0.8, 0.65, 1.3);
  body.castShadow = true;
  g.add(body);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), mat(0x7ff3ff, { emissive: 0x4ae0ff, ei: 2.5 }, materials));
  core.position.set(0, 0, 0.3);
  g.add(core);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.7, 5), mat(0x24525a, {}, materials));
  tail.rotation.x = Math.PI / 2;
  tail.position.z = -0.75;
  g.add(tail);
  const mkWing = (side) => {
    const wing = new THREE.Group();
    const membrane = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 3), mat(0x49b8c4, { emissive: 0x1a7f8f, ei: 0.5 }, materials));
    membrane.scale.z = 0.12;
    membrane.rotation.z = side * Math.PI / 2;
    membrane.position.x = side * 0.55;
    wing.add(membrane);
    g.add(wing);
    return wing;
  };
  const wingL = mkWing(-1), wingR = mkWing(1);
  return { group: g, parts: { body, core, wingL, wingR }, materials };
}

// ---- 4. Blinker: "Void Stalker" — slim figure with orbiting shards ----
export function buildBlinker() {
  const materials = [];
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 1.35, 6), mat(0x1e1a2e, {}, materials));
  body.position.y = 0.85;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 7, 6), mat(0x28203d, {}, materials));
  head.position.y = 1.68;
  head.scale.y = 1.15;
  g.add(head);
  const eye = eyeMesh(0xbb55ff, 0.09, materials);
  eye.position.set(0, 1.7, 0.16);
  eye.scale.set(1.4, 1, 1);
  g.add(eye);
  const shards = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const shard = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.11, 0),
      mat(0x7a3fd9, { emissive: 0x6a2fd0, ei: 1.4, rough: 0.3 }, materials)
    );
    shard.scale.y = 2.2;
    const a = (i / 4) * Math.PI * 2;
    shard.position.set(Math.cos(a) * 0.55, 1.0 + (i % 2) * 0.35, Math.sin(a) * 0.55);
    shards.add(shard);
  }
  g.add(shards);
  return { group: g, parts: { body, eye, shards }, materials };
}

// ---- 5. Shielder: "Aegis Construct" — stocky guardian with rune ring ----
export function buildShielder() {
  const materials = [];
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 1.0, 7), mat(0x8a6f3d, { metal: 0.45, rough: 0.5 }, materials));
  torso.position.y = 0.85;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.32, 6), mat(0x9c7f47, { metal: 0.5, rough: 0.45 }, materials));
  head.position.y = 1.55;
  g.add(head);
  const eye = eyeMesh(0xffd76a, 0.07, materials);
  eye.position.set(0, 1.55, 0.24);
  eye.scale.set(2.2, 0.55, 1);
  g.add(eye);
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.18, 0),
    mat(0xffd76a, { emissive: 0xffc23a, ei: 2.2, rough: 0.25 }, materials)
  );
  core.position.set(0, 0.95, 0.5);
  g.add(core);
  const ring = new THREE.Group();
  const torus = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.035, 6, 24), mat(0xd9b45e, { emissive: 0xcf9a2e, ei: 0.9, metal: 0.5, rough: 0.4 }, materials));
  torus.rotation.x = Math.PI / 2;
  ring.add(torus);
  for (let i = 0; i < 4; i++) {
    const rune = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.05), mat(0xffe08a, { emissive: 0xffd048, ei: 1.6 }, materials));
    const a = (i / 4) * Math.PI * 2;
    rune.position.set(Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95);
    rune.lookAt(0, 0, 0);
    ring.add(rune);
  }
  ring.position.y = 1.0;
  g.add(ring);
  const feet = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.22, 7), mat(0x6e5730, { metal: 0.4, rough: 0.6 }, materials));
  feet.position.y = 0.25;
  g.add(feet);
  return { group: g, parts: { torso, ring, core, eye }, materials };
}

// ---- 6. Bomber: "Cinder Imp" — round ember creature that detonates ----
export function buildBomber() {
  const materials = [];
  const g = new THREE.Group();
  const bodyMat = mat(0x3a2320, { emissive: 0xff4411, ei: 0.7, rough: 0.7 }, materials);
  const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);
  const eyeL = eyeMesh(0xffdd66, 0.06, materials);
  eyeL.position.set(-0.13, 0.62, 0.36);
  g.add(eyeL);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.13; g.add(eyeR);
  const fuse = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 5), mat(0x222222, {}, materials));
  fuse.position.y = 1.02;
  g.add(fuse);
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), mat(0xffcc33, { emissive: 0xffaa22, ei: 3 }, materials));
  spark.position.y = 1.16;
  g.add(spark);
  const mkLeg = (side) => {
    const leg = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.35, 4), mat(0x2a1a18, {}, materials));
    leg.rotation.z = Math.PI;
    leg.position.set(side * 0.22, 0.18, 0);
    g.add(leg);
    return leg;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);
  return { group: g, parts: { body, bodyMat, spark, legL, legR }, materials };
}

// ---- 7. Golem elite: "Stone Colossus" ----
export function buildGolem() {
  const materials = [];
  const g = new THREE.Group();
  const rock = (c) => mat(c, { rough: 1 }, materials);
  const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(1.05, 0), rock(0x6e625a));
  torso.position.y = 1.7;
  torso.scale.set(1, 1.15, 0.85);
  torso.castShadow = true;
  g.add(torso);
  const moss = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), rock(0x5d8a4a));
  moss.position.set(0.15, 2.55, -0.1);
  moss.scale.set(1.3, 0.4, 1);
  g.add(moss);
  const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), rock(0x7d7168));
  head.position.y = 2.85;
  g.add(head);
  const eyeL = eyeMesh(0xffb23a, 0.08, materials);
  eyeL.position.set(-0.15, 2.9, 0.36);
  g.add(eyeL);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.15; g.add(eyeR);
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.3, 0),
    mat(0xffb23a, { emissive: 0xff9922, ei: 2, rough: 0.3 }, materials)
  );
  core.position.set(0, 1.75, 0.75);
  g.add(core);
  const mkArm = (side) => {
    const arm = new THREE.Group();
    const shoulder = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), rock(0x655a52));
    shoulder.castShadow = true;
    arm.add(shoulder);
    const fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62, 0), rock(0x574d46));
    fist.position.y = -1.35;
    fist.castShadow = true;
    arm.add(fist);
    arm.position.set(side * 1.45, 2.3, 0);
    g.add(arm);
    return arm;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  const mkLeg = (side) => {
    const leg = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), rock(0x4f463f));
    leg.position.set(side * 0.55, 0.45, 0);
    leg.scale.set(0.8, 1.1, 0.8);
    g.add(leg);
    return leg;
  };
  mkLeg(-1); mkLeg(1);
  return { group: g, parts: { torso, armL, armR, core, head }, materials };
}

// ---- 8. Storm Knight elite: armored duelist ----
export function buildKnight() {
  const materials = [];
  const g = new THREE.Group();
  const plate = (c, e = 0) => mat(c, { metal: 0.6, rough: 0.4, emissive: e, ei: e ? 1.2 : 1 }, materials);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.85, 6), plate(0x5a6e8c));
  torso.position.y = 1.25;
  torso.castShadow = true;
  g.add(torso);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.3, 0.2, 6), plate(0x3d4a5e));
  belt.position.y = 0.78;
  g.add(belt);
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.7, 6), plate(0x46586f));
  legs.position.y = 0.38;
  g.add(legs);
  const pauldronL = new THREE.Mesh(new THREE.SphereGeometry(0.24, 6, 5), plate(0x6c82a3));
  pauldronL.position.set(-0.46, 1.62, 0);
  pauldronL.scale.set(1.1, 0.75, 1);
  g.add(pauldronL);
  const pauldronR = pauldronL.clone(); pauldronR.position.x = 0.46; g.add(pauldronR);
  const helmet = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.4, 6), plate(0x7089ab));
  helmet.position.y = 1.95;
  g.add(helmet);
  const crest = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.4), plate(0x44ddff, 0x22aadd));
  crest.position.y = 2.2;
  g.add(crest);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.05), mat(0x66eaff, { emissive: 0x44ddff, ei: 3 }, materials));
  visor.position.set(0, 1.95, 0.21);
  g.add(visor);
  // sword arm
  const armR = new THREE.Group();
  const swordGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.25, 6), plate(0x2c3540));
  armR.add(swordGrip);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.35, 0.03), plate(0xcfe0f2));
  blade.position.y = 0.85;
  armR.add(blade);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.35, 0.045), mat(0x88eeff, { emissive: 0x55ddff, ei: 2 }, materials));
  edge.position.set(0.05, 0.85, 0);
  armR.add(edge);
  armR.position.set(0.62, 1.3, 0.15);
  armR.rotation.z = -0.5;
  g.add(armR);
  // shield arm (small buckler)
  const buckler = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.06, 6), plate(0x4d6078));
  buckler.rotation.z = Math.PI / 2;
  buckler.position.set(-0.6, 1.25, 0.1);
  g.add(buckler);
  // tattered cape
  const cape = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.3, 5, 1, true), mat(0x2a3646, { rough: 1 }, materials));
  cape.position.set(0, 1.15, -0.28);
  cape.rotation.x = 0.22;
  g.add(cape);
  return { group: g, parts: { torso, armR, visor, cape, crest }, materials };
}

export const MODEL_BUILDERS = {
  rusher: buildRusher,
  sniper: buildSniper,
  flyer: buildFlyer,
  blinker: buildBlinker,
  shielder: buildShielder,
  bomber: buildBomber,
  golem: buildGolem,
  knight: buildKnight,
};
