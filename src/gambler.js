import * as THREE from 'three';

// ---------------------------------------------------------------------------
// The Gambler: one ability — pull the lever. A 3-reel slot machine decides
// what happens. Every spin lands something: 60% a small good pair, 20% a
// nasty pair, 20% a jackpot triple. Triples are never bad — a bad icon
// tripling FLIPS into its absurdly good version.
// The roll logic is pure (rollSpin) so it can be tested headless.
// ---------------------------------------------------------------------------

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export const GOOD_ICONS = ['cherry', 'coin', 'bolt', 'crown', 'bell', 'gun'];
export const BAD_ICONS = ['skull', 'snake', 'bomb', 'mirror'];
const ALL_ICONS = [...GOOD_ICONS, ...BAD_ICONS];

// glyph + display color per icon (the HUD reads this)
export const SLOT_ICONS = {
  cherry: { glyph: '🍒', color: '#ff5566' },
  coin:   { glyph: '🪙', color: '#ffd24a' },
  bolt:   { glyph: '⚡', color: '#ffee66' },
  crown:  { glyph: '👑', color: '#ffc832' },
  bell:   { glyph: '🔔', color: '#ffb347' },
  gun:    { glyph: '🔫', color: '#9ab8c8' },
  skull:  { glyph: '💀', color: '#ddddee' },
  snake:  { glyph: '🐍', color: '#66dd77' },
  bomb:   { glyph: '💣', color: '#ff6644' },
  mirror: { glyph: '🪞', color: '#bbddff' },
  purple: { glyph: '🟣', color: '#a64dff' },
};

// only these icons can land as a triple (plus rare purple)
export const JACKPOT_ICONS = ['gun', 'skull', 'snake', 'bomb'];

export const RESULT_LABELS = {
  pair: {
    cherry: 'SWEET CHERRY', coin: 'COIN FAN', bolt: 'LIGHTNING DASH',
    crown: 'CROWNED DICE', bell: 'PULSAR BELL', gun: 'SIX SHOOTER',
    skull: 'SKULL BITE', snake: 'SNAKE EYES', bomb: 'LIVE BOMB',
    mirror: 'BAD LUCK…',
  },
  jackpot: {
    gun: 'MINIGUN', skull: 'DEATH ITSELF', snake: 'KING COBRA',
    bomb: 'THE NUKE', purple: 'CURSED JACKPOT',
  },
};

// Pure roll. Odds: 60% good pair / 20% bad pair / 20% jackpot (never bad —
// a bad icon rolled as a jackpot IS the flip). Mirror's curse forces the next
// spin bad; Mirror Fortune flips would-be bad pairs into that icon's jackpot.
// Purple only ever appears as a rare slice of jackpot rolls.
export function rollSpin(state, rand = Math.random) {
  let kind, icon, good;
  const forceBad = state.slotForceBad;
  state.slotForceBad = false;
  if (forceBad) {
    kind = 'pair'; good = false;
    icon = BAD_ICONS[(rand() * BAD_ICONS.length) | 0];
  } else {
    const r = rand();
    if (r < 0.6) {
      kind = 'pair'; good = true;
      icon = GOOD_ICONS[(rand() * GOOD_ICONS.length) | 0];
    } else if (r < 0.8) {
      kind = 'pair'; good = false;
      icon = BAD_ICONS[(rand() * BAD_ICONS.length) | 0];
    } else {
      kind = 'jackpot'; good = true;
      const pool = [...JACKPOT_ICONS, 'purple'];   // purple: equal odds now
      icon = pool[(rand() * pool.length) | 0];
    }
  }
  // reel faces: triples show three, pairs show two + one loser
  let reels;
  if (kind === 'jackpot') {
    reels = [icon, icon, icon];
  } else {
    let other = icon;
    while (other === icon) other = ALL_ICONS[(rand() * ALL_ICONS.length) | 0];
    reels = [icon, icon, other];
  }
  return { kind, icon, good, reels, label: RESULT_LABELS[kind][icon] };
}

// Build a specific spin result (tutorials rig the machine so objectives
// like "land a jackpot" are guaranteed instead of a luck grind)
export function forcedSpin(kind, icon) {
  const loser = icon === 'cherry' ? 'skull' : 'cherry';
  return {
    kind, icon,
    good: kind === 'jackpot' || GOOD_ICONS.includes(icon),
    reels: kind === 'jackpot' ? [icon, icon, icon] : [icon, icon, loser],
    label: RESULT_LABELS[kind][icon],
  };
}

// PvP (duel/ffa): jackpots run shorter and hit softer — luck shouldn't
// decide a round on its own
const pvpMul = (ctx) => (ctx.game.mode === 'solo' ? 1 : 0.62);

// ---- meshes -----------------------------------------------------------------

function stdMat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: opts.rough ?? 0.7, metalness: opts.metal ?? 0,
    emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.ei ?? 1,
    flatShading: true,
  });
}

// a chunky casino die with black pips — used by the viewmodel, the thrown
// bell mesh builder below follows the same painterly look
export function buildDieMesh(size = 0.16) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), stdMat(0xf5f2e8, { rough: 0.45 }));
  g.add(body);
  const pipMat = stdMat(0x1a1420, { rough: 0.3 });
  const s = size / 2;
  const pip = (x, y, z) => {
    const p = new THREE.Mesh(new THREE.SphereGeometry(size * 0.09, 6, 5), pipMat);
    p.position.set(x, y, z);
    g.add(p);
  };
  const o = size * 0.24;
  // front face: 5
  pip(0, 0, s); pip(o, o, s); pip(-o, o, s); pip(o, -o, s); pip(-o, -o, s);
  // top face: 3
  pip(0, s, 0); pip(o, s, o); pip(-o, s, -o);
  // right face: 4
  pip(s, o, o); pip(s, o, -o); pip(s, -o, o); pip(s, -o, -o);
  return g;
}

function buildBellMesh() {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 0.85, 10),
    stdMat(0xf2c14e, { metal: 0.7, rough: 0.35, emissive: 0xaa7716, ei: 0.6 })
  );
  g.add(dome);
  const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), stdMat(0x8a6a1e, { metal: 0.6, rough: 0.4 }));
  clapper.position.y = -0.42;
  g.add(clapper);
  const light = new THREE.PointLight(0xffcc55, 3, 10, 2);
  g.add(light);
  return g;
}

function buildCobraMesh() {
  // group stays at the world origin: the head subgroup and each body segment
  // are positioned in world space every frame, so the head can turn freely
  // without twisting the trailing body around it
  const g = new THREE.Group();
  const goldM = stdMat(0xe8b73a, { metal: 0.65, rough: 0.35, emissive: 0x8a6210, ei: 0.7 });
  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), goldM);
  skull.scale.set(1, 0.85, 1.3);
  head.add(skull);
  const eyeM = stdMat(0xff3322, { emissive: 0xff3322, ei: 3, rough: 0.3 });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), eyeM);
  eyeL.position.set(-0.24, 0.18, 0.4);
  head.add(eyeL);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.24; head.add(eyeR);
  // hood flare
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.5, 8, 1, true), goldM.clone());
  hood.rotation.x = Math.PI / 2.4;
  hood.position.set(0, 0.15, -0.35);
  head.add(hood);
  const light = new THREE.PointLight(0xffcc55, 3, 12, 2);
  head.add(light);
  g.add(head);
  const segs = [];
  for (let i = 0; i < 8; i++) {
    const seg = new THREE.Mesh(new THREE.SphereGeometry(0.5 - i * 0.045, 8, 6), goldM.clone());
    g.add(seg);
    segs.push(seg);
  }
  return { group: g, head, segs };
}

function buildBombMesh() {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), stdMat(0x1c1c26, { rough: 0.4, metal: 0.3 }));
  g.add(shell);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.14, 6), stdMat(0x55525e, { metal: 0.5 }));
  cap.position.y = 0.42;
  g.add(cap);
  const fuseM = stdMat(0xffaa33, { emissive: 0xff8822, ei: 2.5 });
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), fuseM);
  spark.position.y = 0.58;
  g.add(spark);
  const light = new THREE.PointLight(0xff7733, 2, 6, 2);
  light.position.y = 0.6;
  g.add(light);
  g.userData.spark = spark;
  g.userData.light = light;
  return g;
}

function disposeMesh(scene, mesh) {
  scene.remove(mesh);
  mesh.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

// ---- shared helpers ---------------------------------------------------------

// nearest alive enemy to a point, optionally excluding one
function nearestEnemy(ctx, point, exclude = null) {
  let best = null, bd = Infinity;
  for (const e of ctx.enemies()) {
    if (!e.alive || e === exclude) continue;
    const d = e.position.distanceToSquared(point);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// light aim assist for the m1s: whoever is nearest the crosshair, else nobody
function aimTarget(ctx) {
  return ctx.rayHits(ctx.muzzle(), ctx.aimDir(), 70, 7)[0] || null;
}

// the coin fan: five hunting coins spread across the nearest targets so it
// feels like a smart shotgun; leftover coins follow the crosshair target
function fireCoinFan(ctx) {
  const dir = ctx.aimDir();
  const m = ctx.muzzle();
  const targets = ctx.enemies().filter((e) => e.alive)
    .sort((a, b) => a.position.distanceToSquared(ctx.player.position) - b.position.distanceToSquared(ctx.player.position))
    .slice(0, 5);
  const aimT = aimTarget(ctx);
  for (let i = -2; i <= 2; i++) {
    const d = dir.clone().applyAxisAngle(_v1.set(0, 1, 0), i * 0.11);
    const target = targets.length ? targets[(i + 2) % targets.length] : aimT;
    ctx.projectiles.spawn({
      pos: m.clone(), vel: d.multiplyScalar(62),
      damage: 13, aoe: 1.2, aoeDamage: 6, color: 0xffd24a, coreColor: 0xfff6d8,
      size: 0.32, radius: 0.4, knockback: 6, life: 1.6, gravity: 0,
      homing: target ? 9 : 0, homingTarget: target, trailEvery: 0.016,
    });
  }
  ctx.effects.ring(m, { color: 0xffd24a, endRadius: 1.8, life: 0.25, axis: 'x', thickness: 0.3 });
  ctx.audio?.play('firebolt');
}

function spawnHomingSkull(ctx, from, target) {
  ctx.projectiles.spawn({
    pos: from.clone(), vel: ctx.aimDir().multiplyScalar(46),
    damage: 18, aoe: 2.6, aoeDamage: 10, color: 0x9a5fff, coreColor: 0x15111f,
    size: 0.55, radius: 0.6, knockback: 8, life: 2.2, gravity: 0,
    homing: target ? 5 : 0, homingTarget: target, trailEvery: 0.012,
  });
}

// ---- the spin results -------------------------------------------------------

const PAIR_FX = {
  cherry(ctx) {
    const heal = ctx.game.mode === 'solo' ? 30 : 22;
    ctx.player.heal(heal);
    const c = ctx.player.position.clone(); c.y += 1.2;
    ctx.effects.burst(c, { count: 16, color: 0xff5566, color2: 0x88ff99, speed: 5, size: 0.22, life: 0.45, gravity: -3 });
    ctx.effects.glow(c, { color: 0xff8899, size: 1.6, life: 0.4 });
    ctx.audio?.play('buff');
  },
  coin(ctx, state) {
    // loads the fan into your next m1: five homing coins that hunt targets
    state.loadedShot = 'coins';
    const m = ctx.muzzle();
    ctx.effects.ring(m, { color: 0xffd24a, endRadius: 1.6, life: 0.22, axis: 'x', thickness: 0.25 });
    ctx.effects.glow(m, { color: 0xffd24a, size: 1.2, life: 0.3 });
    ctx.audio?.play('buff');
  },
  bolt(ctx, state) {
    // lightning in your legs: the NEXT dash you take becomes the mega-dash
    state.boltLoaded = true;
    const p = ctx.player;
    ctx.effects.ring(p.position.clone().add(_v1.set(0, 1, 0)), { color: 0xffee66, endRadius: 2.4, life: 0.25, axis: 'x', thickness: 0.3 });
    ctx.effects.glow(p.position.clone().add(_v1.set(0, 0.5, 0)), { color: 0xffee66, size: 1.2, life: 0.3 });
    ctx.audio?.play('zap');
  },
  crown(ctx, state) {
    state.crownT = 6;
    const c = ctx.player.position.clone(); c.y += 1.4;
    ctx.effects.burst(c, { count: 14, color: 0xffc832, speed: 4, size: 0.2, life: 0.4, gravity: -4 });
    ctx.effects.glow(c.clone().add(_v1.set(0, 0.8, 0)), { color: 0xffc832, size: 1.4, life: 0.5 });
    ctx.audio?.play('buff');
  },
  bell(ctx, state) {
    // loads the bell into your very next m1 — throw it where you want it
    state.loadedShot = 'bell';
    ctx.effects.glow(ctx.muzzle(), { color: 0xffb347, size: 1.2, life: 0.3 });
    ctx.audio?.play('buff');
  },
  gun(ctx, state) {
    state.gunT = 5;
    ctx.viewmodel.trigger('heavy');
    ctx.effects.glow(ctx.muzzle(), { color: 0x9ab8c8, size: 1.2, life: 0.3 });
    ctx.audio?.play('mark');
  },
  skull(ctx) {
    // the machine bites HALF your current health — never lethal, always brutal
    const p = ctx.player;
    const bite = p.health * 0.5;
    if (bite > 0.5) p.takeDamage(bite, null, { pierceInvuln: true });
    ctx.game.hud?.flash('rgba(160, 40, 40, 0.22)', 0.3);
    ctx.effects.burst(p.position.clone().add(_v1.set(0, 1.4, 0)), {
      count: 12, color: 0xddddee, color2: 0x883344, speed: 6, size: 0.22, life: 0.35,
    });
    ctx.shake(0.3);
    ctx.audio?.play('playerHurt');
  },
  snake(ctx, state) {
    state.snakeT = 4.5;
    ctx.game.hud?.flash('rgba(60, 180, 90, 0.16)', 0.3);
    ctx.effects.burst(ctx.player.position.clone().add(_v1.set(0, 0.5, 0)), {
      count: 14, color: 0x66dd77, speed: 4, size: 0.2, life: 0.4, gravity: 5, additive: false,
    });
    ctx.audio?.play('pull');
  },
  bomb(ctx, state) {
    // lit bomb dropped at your feet — 2 second fuse, RUN
    if (state.bombObj) disposeMesh(ctx.game.scene, state.bombObj.mesh);
    const mesh = buildBombMesh();
    const pos = ctx.player.position.clone();
    mesh.position.copy(pos).add(_v1.set(0, 0.4, 0));
    ctx.game.scene.add(mesh);
    state.bombObj = { pos, t: 0.8, mesh };   // dash NOW or eat it
    // replicated drop FX: rivals must SEE the bomb they're about to stand on
    ctx.effects.ring(pos.clone().add(_v1.set(0, 0.3, 0)), { color: 0xff6644, endRadius: 2.2, life: 0.35, thickness: 0.3 });
    ctx.effects.glow(pos.clone().add(_v1.set(0, 0.6, 0)), { color: 0xff7733, size: 1.4, life: 0.3 });
    ctx.audio?.play('fuse');
  },
  mirror(ctx, state) {
    state.slotForceBad = true;
    ctx.game.hud?.flash('rgba(120, 140, 200, 0.18)', 0.3);
    ctx.effects.burst(ctx.player.position.clone().add(_v1.set(0, 1.5, 0)), {
      count: 16, color: 0xbbddff, color2: 0x445577, speed: 7, size: 0.18, life: 0.4, gravity: 6, additive: false,
    });
    ctx.audio?.play('whoosh');
  },
};

const JACKPOT_FX = {
  gun(ctx, state) {
    state.minigunT = 8 * pvpMul(ctx);
    ctx.viewmodel.trigger('heavy');
    ctx.effects.ring(ctx.muzzle(), { color: 0x9ab8c8, endRadius: 2, life: 0.3, axis: 'x', thickness: 0.3 });
    ctx.audio?.play('charge');
  },
  skull(ctx, state) {
    state.reaperT = 8 * pvpMul(ctx);
    state.reaperWatch = new Set();
    ctx.game.hud?.flash('rgba(90, 40, 140, 0.25)', 0.4);
    const c = ctx.player.position.clone(); c.y += 1;
    ctx.effects.ring(c, { color: 0x9a5fff, endRadius: 5, life: 0.5, thickness: 0.5 });
    ctx.effects.burst(c, { count: 26, color: 0x15111f, color2: 0x9a5fff, speed: 8, size: 0.3, life: 0.55, additive: false });
    ctx.audio?.play('roar');
  },
  snake(ctx, state) {
    if (state.cobra) disposeMesh(ctx.game.scene, state.cobra.mesh);
    const built = buildCobraMesh();
    const pos = ctx.player.position.clone().add(_v1.set(0, 2, 0));
    built.head.position.copy(pos);
    ctx.game.scene.add(built.group);
    state.cobra = {
      pos, t: 9 * pvpMul(ctx), mesh: built.group, head: built.head, segs: built.segs,
      trail: [], hitCd: new Map(), wander: 0,
    };
    ctx.effects.burst(pos, { count: 20, color: 0xe8b73a, speed: 7, size: 0.26, life: 0.5 });
    ctx.audio?.play('roar');
  },
  bomb(ctx, state) {
    // THE NUKE: loaded into your next m1 — you choose when and where
    state.loadedShot = 'nuke';
    ctx.effects.ring(ctx.muzzle(), { color: 0xff6644, endRadius: 2, life: 0.3, axis: 'x', thickness: 0.35 });
    ctx.effects.glow(ctx.muzzle(), { color: 0xff6644, size: 1.4, life: 0.35 });
    ctx.audio?.play('windup');
  },
  purple(ctx, state) {
    state.purpleT = 10 * pvpMul(ctx);
    ctx.game.hud?.flash('rgba(166, 77, 255, 0.3)', 0.5);
    const c = ctx.player.position.clone(); c.y += 1.2;
    ctx.effects.ring(c, { color: 0xa64dff, endRadius: 6, life: 0.6, thickness: 0.6 });
    ctx.effects.burst(c, { count: 30, color: 0xa64dff, color2: 0xf0e0ff, speed: 9, size: 0.3, life: 0.6 });
    ctx.shake(0.4);
    ctx.audio?.play('explosion');
  },
};

// how long each timed result runs — drives the duration bar under the reels
// (jackpot durations scale with the PvP tone-down, matching the effects)
const PAIR_DUR = { crown: 6, gun: 5, snake: 4.5, bell: 3.2, bomb: 0.8 };
const JACKPOT_DUR = { gun: 8, skull: 8, snake: 9, purple: 10 };

export function applyResult(ctx, state, res) {
  if (!ctx.player.alive) return;
  const table = res.kind === 'jackpot' ? JACKPOT_FX : PAIR_FX;
  table[res.icon](ctx, state);
  const dur = res.kind === 'jackpot'
    ? (JACKPOT_DUR[res.icon] || 0) * pvpMul(ctx)
    : PAIR_DUR[res.icon] || 0;
  state.rollT = state.rollTotal = dur;   // 0 for instant results: bar clears
  if (res.kind === 'jackpot') {
    ctx.game.hud?.announce(res.label, 'gold');
  }
}

// ---- the class --------------------------------------------------------------

export const gamblerClass = {
  id: 'gambler',
  name: 'The Gambler',
  role: 'Luck incarnate',
  tagline: 'The house always wins. You ARE the house. Probably.',
  playstyle: 'One ability: pull the lever. The slot machine decides the rest — a heal, a gun, a golden serpent, a nuke in your hands, or a bomb at your feet. Two-in-a-row lands something small (and sometimes nasty); three-in-a-row is always a jackpot. Ride the hot streaks, survive the cold ones.',
  color: 0xffd24a,
  slotMachine: true,   // HUD shows the 3-reel machine
  stats: { maxHealth: 85, walkSpeed: 11.5, maxDashes: 3, dashSpeed: 40 },

  update(ctx, dt, state) {
    const p = ctx.player;
    const S = ctx.game.scene;

    // ---- timers ----
    for (const k of ['crownT', 'gunT', 'minigunT', 'reaperT', 'purpleT', 'snakeT', 'rollT']) {
      if (state[k] > 0) state[k] -= dt;
    }

    // ---- per-frame stat mods (never mutate permanently: recomputed each tick).
    // speedMul, not walkSpeed: duel/ffa write walkSpeed directly for incoming
    // PvP slows, and the two channels must stack, not overwrite each other ----
    p.speedMul = state.snakeT > 0 ? 0.62 : 1;
    p.gravityScale = state.snakeT > 0 ? 1.8 : 1;

    // ---- lightning loaded: the next dash you take goes off like a bolt ----
    if (state.boltLoaded && p.dashTimer > 0 && !(state._prevDashTimer > 0)) {
      state.boltLoaded = false;
      state.megaDashT = 0.5;
      state.megaDashDir = p.dashDir.clone();
      p.dashTimer = 0;   // the mega-dash owns velocity now
      p.invulnTimer = Math.max(p.invulnTimer, 0.3);
      ctx.effects.dashStreaks(ctx.camera);
      ctx.effects.ring(p.position.clone().add(_v1.set(0, 1, 0)), { color: 0xffee66, endRadius: 2.4, life: 0.25, axis: 'x', thickness: 0.3 });
      ctx.audio?.play('zap');
    }
    state._prevDashTimer = p.dashTimer;
    if (state.boltLoaded && Math.random() < dt * 10) {
      ctx.effects.glow(p.position.clone().add(_v1.set((Math.random() - 0.5) * 0.8, 0.3, (Math.random() - 0.5) * 0.8)), { color: 0xffee66, size: 0.5, life: 0.15, grow: -0.5 });
    }

    // ---- lightning mega-dash ----
    if (state.megaDashT > 0) {
      state.megaDashT -= dt;
      p.vel.copy(state.megaDashDir).multiplyScalar(68);
      p.stallTimer = 0;
      if (Math.random() < dt * 40) {
        ctx.effects.glow(p.position.clone().add(_v1.set(0, 1, 0)), { color: 0xffee66, size: 1.1, life: 0.15 });
      }
      if (state.megaDashT <= 0) p.vel.multiplyScalar(0.4);
    }

    // ---- pulsar bells (bell mode m1s, several can be live at once) ----
    if (state.bells && state.bells.length) {
      for (let i = state.bells.length - 1; i >= 0; i--) {
        const B = state.bells[i];
        B.t -= dt;
        // constant slow drift along the throw line
        B.pos.addScaledVector(B.vel, dt);
        B.mesh.position.copy(B.pos);
        B.mesh.rotation.z = Math.sin(ctx.game.simTime * 10 + i * 1.7) * 0.3;
        B.tick -= dt;
        if (B.tick <= 0) {
          B.tick = 0.5;
          // the pulse is a full 3D sphere, matching the damage volume
          ctx.effects.sphere(B.pos.clone(), { color: 0xffb347, startRadius: 0.6, endRadius: 5.5, life: 0.35, opacity: 0.45 });
          for (const e of ctx.sphereHit(B.pos, 5.5)) {
            ctx.dealDamage(e, 9, { knockback: _v1.copy(e.position).sub(B.pos).normalize().multiplyScalar(6).setY(3) });
          }
          if (i === 0) ctx.audio?.play('dome');
        }
        if (B.t <= 0) {
          ctx.effects.burst(B.pos.clone(), { count: 12, color: 0xffb347, speed: 6, size: 0.22, life: 0.35 });
          disposeMesh(S, B.mesh);
          state.bells.splice(i, 1);
        }
      }
    }

    // ---- live bomb at your feet ----
    if (state.bombObj) {
      const B = state.bombObj;
      B.t -= dt;
      // frantic accelerating beep-glow
      const spark = B.mesh.userData.spark;
      const k = 1 - Math.max(0, B.t) / 0.8;
      spark.material.emissiveIntensity = 2 + Math.sin(ctx.game.simTime * (8 + k * 30)) * 2;
      B.mesh.userData.light.intensity = 1.5 + k * 2;
      // replicated fuse sparks: the countdown reads on rival screens too
      if (Math.random() < dt * (6 + k * 14)) {
        ctx.effects.glow(B.pos.clone().add(_v1.set(0, 0.8, 0)), { color: 0xff7733, size: 0.5 + k * 0.5, life: 0.16 });
      }
      if (B.t <= 0) {
        const c = B.pos.clone(); c.y += 0.5;
        const R = 8;
        for (const e of ctx.sphereHit(c, R)) {
          ctx.dealDamage(e, 35, { knockback: _v1.copy(e.position).sub(c).normalize().multiplyScalar(14).setY(8) });
        }
        // it was YOUR bomb: if you didn't run, you eat it too
        const dp = p.position.distanceTo(B.pos);
        if (dp < R && p.alive) {
          p.takeDamage(25, c, {});
          p.applyKnockback(_v2.copy(p.position).sub(c).normalize().multiplyScalar(12).setY(10));
        }
        ctx.effects.impactBurst(c, { color: 0xffb266, size: 5 });
        ctx.effects.ring(c, { color: 0xff6644, endRadius: R, life: 0.5, thickness: 0.6 });
        ctx.game.hitstop(0.08);
        ctx.shake(0.5);
        ctx.audio?.play('explosion');
        disposeMesh(S, B.mesh);
        state.bombObj = null;
      }
    }

    // ---- death itself: nearby kills burst into homing skulls ----
    if (state.reaperT > 0) {
      const near = new Set();
      for (const e of ctx.enemies()) {
        const close = e.position.distanceToSquared(p.position) < 16 * 16;
        if (e.alive && close) near.add(e);
        else if (!e.alive && state.reaperWatch && state.reaperWatch.has(e)) {
          const c = e.center(new THREE.Vector3());
          const t1 = nearestEnemy(ctx, c, e);
          spawnHomingSkull(ctx, c, t1);
          spawnHomingSkull(ctx, c, nearestEnemy(ctx, t1 ? t1.position : c, t1 || e) || t1);
          ctx.effects.burst(c, { count: 14, color: 0x15111f, color2: 0x9a5fff, speed: 8, size: 0.28, life: 0.45, additive: false });
        }
      }
      state.reaperWatch = near;
      // shadow aura
      if (Math.random() < dt * 14) {
        ctx.effects.glow(p.position.clone().add(_v1.set((Math.random() - 0.5) * 1.4, 0.6 + Math.random() * 1.4, (Math.random() - 0.5) * 1.4)), {
          color: 0x9a5fff, size: 0.8, life: 0.3, additive: false,
        });
      }
    }

    // ---- king cobra ----
    if (state.cobra) {
      const C = state.cobra;
      C.t -= dt;
      for (const [e, cd] of C.hitCd) {
        if (cd - dt <= 0) C.hitCd.delete(e);
        else C.hitCd.set(e, cd - dt);
      }
      const target = nearestEnemy(ctx, C.pos);
      if (target) {
        const tc = target.center(new THREE.Vector3());
        _v1.copy(tc).sub(C.pos).normalize();
        // fast enough to cross the map and run down walkers — but a burst of
        // dash-spam still outruns the strike range
        C.pos.addScaledVector(_v1, dt * 34);
        C.pos.y += Math.sin(ctx.game.simTime * 6) * dt * 3;   // serpentine bob
        if (C.pos.distanceTo(tc) < 2.6 && !C.hitCd.has(target)) {
          C.hitCd.set(target, 0.8);
          ctx.dealDamage(target, 16, { knockback: _v2.set(0, 9, 0) });
          ctx.effects.impactBurst(tc, { color: 0xe8b73a, size: 2.4 });
          ctx.game.hitstop(0.04);
          ctx.audio?.play('punchHit');
        }
        C.head.lookAt(tc);
      } else {
        // no prey: circle the gambler
        C.wander += dt * 1.5;
        const goal = _v1.set(p.position.x + Math.cos(C.wander) * 7, p.position.y + 3, p.position.z + Math.sin(C.wander) * 7);
        _v2.copy(goal).sub(C.pos);
        if (_v2.lengthSq() > 0.1) C.pos.addScaledVector(_v2.normalize(), dt * 18);
      }
      C.head.position.copy(C.pos);
      // body follows the head's history
      C.trail.unshift(C.pos.clone());
      if (C.trail.length > 64) C.trail.pop();
      C.segs.forEach((seg, i) => {
        const idx = Math.min((i + 1) * 6, C.trail.length - 1);
        if (C.trail[idx]) seg.position.copy(C.trail[idx]);
      });
      if (Math.random() < dt * 10) {
        ctx.effects.glow(C.pos.clone(), { color: 0xe8b73a, size: 0.9, life: 0.25 });
      }
      if (C.t <= 0) {
        ctx.effects.burst(C.pos.clone(), { count: 22, color: 0xe8b73a, speed: 8, size: 0.28, life: 0.5 });
        disposeMesh(S, C.mesh);
        state.cobra = null;
      }
    }

    // ---- loaded-shot shimmer: the chambered throw glints at the muzzle ----
    if (state.loadedShot && Math.random() < dt * 10) {
      const glint = { coins: 0xffd24a, bell: 0xffb347, nuke: 0xff6644 }[state.loadedShot];
      ctx.effects.glow(ctx.muzzle(), { color: glint, size: 0.5, life: 0.16, grow: -0.6 });
    }

    // ---- auras for timed powers ----
    if (state.purpleT > 0 && Math.random() < dt * 16) {
      ctx.effects.glow(p.position.clone().add(_v1.set((Math.random() - 0.5) * 1.6, 0.5 + Math.random() * 1.6, (Math.random() - 0.5) * 1.6)), {
        color: Math.random() < 0.5 ? 0xff2244 : 0x3366ff, size: 0.5, life: 0.25, grow: -1,
      });
    }
  },

  basic: {
    name: 'Loaded Dice',
    desc: 'Hurl weighted dice that crack on impact. Firing in the air softens your fall. Jackpots can turn this into a revolver, a minigun, homing skulls — or Purple.',
    cooldown: 0.32,
    execute(ctx, state) {
      ctx.slowFallIfAirborne(0.5);
      const dir = ctx.aimDir();
      const m = ctx.muzzle();
      const mode = ctx.game.mode;

      // ---- CURSED JACKPOT: spam purple nukes, no windup ----
      if (state.purpleT > 0) {
        ctx.viewmodel.trigger('heavy');
        const solo = mode === 'solo';
        ctx.projectiles.spawn({
          pos: m.clone(), vel: dir.clone().multiplyScalar(45),
          damage: solo ? 95 : 60, aoe: solo ? 20 : 14, aoeDamage: solo ? 60 : 38,
          color: 0xa64dff, coreColor: 0xf0e0ff,
          size: 5.2, radius: 5.2, knockback: 26, life: 1.6, gravity: 0,
          trailEvery: 0.006, explodeOnExpire: true,
          onImpact: (pos) => {
            ctx.shake(0.6);
            ctx.game.hitstop(0.1);
            ctx.game.hud?.flash('rgba(166, 77, 255, 0.2)', 0.3);
            ctx.effects.impactBurst(pos, { color: 0xcc88ff, size: 9 });
            ctx.effects.ring(pos, { color: 0xa64dff, endRadius: 14, life: 0.5, thickness: 0.7 });
            ctx.audio?.play('meteorHit');
          },
        });
        ctx.effects.ring(m, { color: 0xa64dff, endRadius: 3, life: 0.3, axis: 'x', thickness: 0.4 });
        ctx.shake(0.3);
        ctx.audio?.play('explosion');
        return solo ? 0.85 : 1.15;
      }

      // ---- MINIGUN: hitscan shred — it's a gun, bullets don't travel ----
      if (state.minigunT > 0) {
        ctx.viewmodel.trigger('punch');
        const d = dir.clone().add(_v1.set((Math.random() - 0.5) * 0.07, (Math.random() - 0.5) * 0.07, (Math.random() - 0.5) * 0.07)).normalize();
        const hit = ctx.rayHits(m.clone(), d, 80, 1.0)[0];
        // misses draw a short tracer, not an arena-length one — fill rate
        // from 18 fullscreen additive beams a second was tanking the frame
        const end = hit ? hit.center(new THREE.Vector3()) : _v2.copy(m).addScaledVector(d, 34).clone();
        ctx.effects.beam(m, end, { color: 0xffe08a, radius: 0.045, life: 0.06 });
        if (hit) {
          ctx.dealDamage(hit, mode === 'solo' ? 6 : 5, { knockback: _v1.copy(d).multiplyScalar(2) });
          ctx.effects.glow(end, { color: 0xffcc66, size: 0.5, life: 0.1 });
        }
        if (Math.random() < 0.4) ctx.effects.glow(m, { color: 0xffcc66, size: 0.5, life: 0.06 });
        ctx.audio?.play('zapShot');
        return 0.055;
      }

      // ---- SIX SHOOTER: hard hitscan revolver ----
      if (state.gunT > 0) {
        ctx.viewmodel.trigger('cast');
        const hit = ctx.rayHits(m.clone(), dir, 90, 0.9)[0];
        const end = hit ? hit.center(new THREE.Vector3()) : _v2.copy(m).addScaledVector(dir, 44).clone();
        ctx.effects.beam(m, end, { color: 0xcfe4f2, radius: 0.07, life: 0.12 });
        if (hit) {
          ctx.dealDamage(hit, 7, { knockback: _v1.copy(dir).multiplyScalar(6).setY(2) });
          ctx.effects.impactBurst(end, { color: 0xcfe4f2, size: 1.4 });
          ctx.game.hitstop(0.02);
        }
        ctx.effects.glow(m, { color: 0xcfe4f2, size: 0.8, life: 0.1 });
        ctx.audio?.play('firebolt');
        return 0.17;
      }

      // ---- DEATH ITSELF: homing skulls ----
      if (state.reaperT > 0) {
        ctx.viewmodel.trigger('cast');
        const target = aimTarget(ctx) || nearestEnemy(ctx, ctx.player.position);
        spawnHomingSkull(ctx, m, target);
        ctx.effects.glow(m, { color: 0x9a5fff, size: 0.9, life: 0.12 });
        ctx.audio?.play('firebolt');
        return 0.3;
      }

      // ---- LOADED SHOT: a rolled throw waits in the chamber for this m1 ----
      if (state.loadedShot) {
        const shot = state.loadedShot;
        state.loadedShot = null;
        ctx.viewmodel.trigger('heavy');
        if (shot === 'coins') {
          fireCoinFan(ctx);
          return 0.4;
        }
        if (shot === 'bell') {
          // hurl the bell: it drifts on slowly, pulsing spheres as it goes
          state.bells = state.bells || [];
          while (state.bells.length) {
            disposeMesh(ctx.game.scene, state.bells.pop().mesh);
          }
          const mesh = buildBellMesh();
          const pos = m.clone();
          mesh.position.copy(pos);
          ctx.game.scene.add(mesh);
          state.bells.push({ pos, vel: dir.clone().multiplyScalar(8), t: 3.2, tick: 0.5, mesh });
          ctx.audio?.play('charge');
          return 0.5;
        }
        if (shot === 'nuke') {
          // THE NUKE — big arc, mushroom cloud
          const mul = pvpMul(ctx);
          ctx.projectiles.spawn({
            pos: m.clone(), vel: dir.clone().multiplyScalar(34).add(_v1.set(0, 6, 0)),
            damage: 130 * mul, aoe: 13 * (0.6 + 0.4 * mul), aoeDamage: 85 * mul,
            color: 0xff6644, coreColor: 0x1c1c26, size: 1.5, radius: 1.4,
            knockback: 24, life: 3, gravity: 10, trailEvery: 0.01,
            onImpact: (pos) => {
              ctx.shake(0.8);
              ctx.game.hitstop(0.13);
              ctx.game.hud?.flash('rgba(255, 120, 60, 0.3)', 0.5);
              ctx.effects.impactBurst(pos, { color: 0xffb266, size: 8 });
              ctx.effects.ring(pos, { color: 0xff6644, endRadius: 13, life: 0.6, thickness: 0.7 });
              // mushroom stem + cap
              ctx.effects.burst(pos, { count: 30, color: 0xff9955, color2: 0x333333, speed: 9, size: 0.5, life: 0.9, gravity: -7 });
              ctx.effects.burst(pos.clone().add(new THREE.Vector3(0, 6, 0)), { count: 26, color: 0x555555, color2: 0xff7733, speed: 5, size: 0.7, life: 1.1, gravity: -2, additive: false });
              ctx.audio?.play('meteorHit');
            },
          });
          ctx.effects.ring(m, { color: 0xff6644, endRadius: 2.5, life: 0.3, axis: 'x', thickness: 0.4 });
          ctx.shake(0.3);
          ctx.audio?.play('charge');
          return 0.8;
        }
      }

      // ---- default: loaded dice (crown pair beefs them up) ----
      ctx.viewmodel.trigger('cast');
      const crowned = state.crownT > 0;
      const giant = state.giantT > 0;
      const assist = aimTarget(ctx);   // a little homing — aim help, not aimbot
      ctx.projectiles.spawn({
        pos: m.clone(), vel: dir.clone().multiplyScalar(58),
        damage: 12 * (crowned ? 1.6 : 1) * (giant ? 2.5 : 1),
        aoe: giant ? 4 : 1.4, aoeDamage: giant ? 18 : 7,
        color: 0xffe9b0, coreColor: 0xffffff,
        size: 0.42 * (crowned ? 3.0 : 1) * (giant ? 2.6 : 1),
        radius: 0.45 * (crowned ? 2.4 : 1) * (giant ? 2.4 : 1),
        knockback: giant ? 14 : 6, pierce: crowned || giant, life: 1.6,
        gravity: 3, homing: assist ? 1.2 : 0, homingTarget: assist, trailEvery: 0.016,
      });
      ctx.effects.glow(m, { color: 0xffd24a, size: 0.8, life: 0.1 });
      ctx.audio?.play('firebolt');
    },
  },

  abilities: [
    {
      slot: 'Q', name: 'Pull the Lever', cooldown: 4,
      desc: 'Spin the slot machine. Two-in-a-row: something small — usually good, sometimes a curse. Three-in-a-row: a jackpot, never bad. What lands is pure luck.',
      execute(ctx, state) {
        // the tutorial preloads a queue of chosen results; real play rolls
        const rig = ctx.game.tutorialSpins;
        const res = rig && rig.length ? rig.shift() : rollSpin(state, Math.random);
        ctx.viewmodel.trigger('cast');
        ctx.game.hud?.spinSlots(res);
        ctx.audio?.play('chargeStart');
        // reels land one by one; the payoff fires as the last reel locks
        ctx.delay(0.85, () => applyResult(ctx, state, res));
        return 4;
      },
    },
  ],
};
