import * as THREE from 'three';
import { buildBlueOrb, buildPurpleOrb, buildRiftMesh } from './classes.js';

// ---------------------------------------------------------------------------
// FxNet: replicates ability visuals to the other players.
//
// recordingEffects() wraps the Effects manager with the same API; every call
// plays locally AND appends a compact serialized event to a buffer. The duel /
// FFA managers flush that buffer on the 20Hz snapshot cadence as {t:'fx'}
// messages; applyFx() replays the events in the receiver's world.
//
// Persistent class props (Sorcerer's Blue orb, Purple Nuke channel orb, the
// mage's Rift Anchor) are meshes rather than effects, so they get lifecycle
// events ('prop') and a dumb cosmetic copy animated on the receiving side.
// ---------------------------------------------------------------------------

// serializable subset of effect options (everything the classes actually use)
const OPT_KEYS = [
  'count', 'color', 'color2', 'speed', 'size', 'life', 'gravity', 'spread',
  'additive', 'grow', 'fade', 'radius', 'coreColor', 'startRadius',
  'endRadius', 'axis', 'opacity', 'thickness',
];

function packVec(v) {
  return [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
}
function packOpts(o = {}) {
  const out = {};
  for (const k of OPT_KEYS) if (o[k] !== undefined) out[k] = o[k];
  if (o.direction) out.dir = packVec(o.direction);
  return out;
}

export function recordingEffects(effects, buf) {
  // ponytail: hard cap per flush window — overflow drops silently, it's cosmetics
  const push = (e) => { if (buf.length < 64) buf.push(e); };
  return {
    burst(p, o) { effects.burst(p, o); push({ f: 'burst', p: packVec(p), o: packOpts(o) }); },
    glow(p, o) { const r = effects.glow(p, o); push({ f: 'glow', p: packVec(p), o: packOpts(o) }); return r; },
    beam(a, b, o) { effects.beam(a, b, o); push({ f: 'beam', p: packVec(a), q: packVec(b), o: packOpts(o) }); },
    ring(p, o) { effects.ring(p, o); push({ f: 'ring', p: packVec(p), o: packOpts(o) }); },
    sphere(p, o) { effects.sphere(p, o); push({ f: 'sphere', p: packVec(p), o: packOpts(o) }); },
    marker(p, o) { effects.marker(p, o); push({ f: 'marker', p: packVec(p), o: packOpts(o) }); },
    impactBurst(p, o) { effects.impactBurst(p, o); push({ f: 'impact', p: packVec(p), o: packOpts(o) }); },
    dashStreaks(cam) { effects.dashStreaks(cam); },   // camera-local speed lines: meaningless remotely
    prop(k, d) { push({ f: 'prop', k, d }); },        // persistent mesh lifecycle, no local render
  };
}

export function applyFx(game, list, avatar) {
  if (!Array.isArray(list)) return;
  const fx = game.effects;
  for (const e of list) {
    const p = e.p ? new THREE.Vector3(e.p[0], e.p[1], e.p[2]) : null;
    let o = e.o || {};
    if (o.dir) {
      o = { ...o, direction: new THREE.Vector3(o.dir[0], o.dir[1], o.dir[2]) };
      delete o.dir;
    }
    switch (e.f) {
      case 'burst': fx.burst(p, o); break;
      case 'glow': fx.glow(p, o); break;
      case 'beam': fx.beam(p, new THREE.Vector3(e.q[0], e.q[1], e.q[2]), o); break;
      case 'ring': fx.ring(p, o); break;
      case 'sphere': fx.sphere(p, o); break;
      case 'marker': fx.marker(p, o); break;
      case 'impact': fx.impactBurst(p, o); break;
      case 'prop': applyProp(game, e, avatar); break;
    }
  }
}

// ---------------------------------------------------------------------------
// persistent props on the receiving side
// ---------------------------------------------------------------------------

function disposeGroup(scene, mesh) {
  scene.remove(mesh);
  mesh.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

// one live prop per kind per rival (matches the class code's own gating)
function store(avatar, game) {
  if (avatar) return (avatar.fxProps ??= {});
  return (game.fxProps ??= {});
}

export function killFxProps(avatar) {
  if (!avatar || !avatar.fxProps) return;
  for (const k in avatar.fxProps) avatar.fxProps[k]?.kill();
}

function applyProp(game, e, avatar) {
  const S = store(avatar, game);
  const d = e.d || {};
  switch (e.k) {
    case 'blue': {
      S.blue?.kill();
      const mesh = buildBlueOrb();
      const pos = new THREE.Vector3(d.p[0], d.p[1], d.p[2]);
      const vel = new THREE.Vector3(d.v[0], d.v[1], d.v[2]);
      mesh.position.copy(pos);
      mesh.getObjectByName('pullRadius').scale.setScalar(d.r || 8);
      mesh.getObjectByName('pullRadiusEdge').scale.setScalar(d.r || 8);
      game.scene.add(mesh);
      let t = Math.min(d.t || 4, 8), done = false;
      const item = {
        kill() { done = true; },
        update(dt) {
          if (done) return false;
          t -= dt;
          pos.addScaledVector(vel, dt);
          mesh.position.copy(pos);
          mesh.rotation.y += dt * 1.6;
          mesh.scale.setScalar(1 + Math.sin(game.simTime * 6) * 0.06);
          return t > 0;
        },
        dispose() { disposeGroup(game.scene, mesh); if (S.blue === item) S.blue = null; },
      };
      S.blue = item;
      game.effects._add(item);
      break;
    }
    case 'blueEnd': S.blue?.kill(); break;

    case 'nuke': {
      if (!avatar) break;   // hangs off the caster's avatar
      S.nuke?.kill();
      const mesh = buildPurpleOrb();
      const light = mesh.getObjectByName('nukeLight');
      game.scene.add(mesh);
      let t = 0, done = false;
      const item = {
        kill() { done = true; },
        update(dt) {
          if (done || !avatar.alive) return false;
          t += dt;
          if (t > 3.4) return false;   // safety: fire event should have killed it
          const k = Math.min(1, t / 3);
          // same placement math as the caster's client: eye + aim * (2.6..4.2)
          const cp = Math.cos(avatar.net.pitch), sp = Math.sin(avatar.net.pitch);
          const cy = Math.cos(avatar.net.yaw), sy = Math.sin(avatar.net.yaw);
          mesh.position.set(
            avatar.position.x + -sy * cp * (2.6 + k * 1.6),
            avatar.position.y + 1.55 + sp * (2.6 + k * 1.6),
            avatar.position.z + -cy * cp * (2.6 + k * 1.6)
          );
          mesh.scale.setScalar(0.25 + k * 2.3);
          mesh.rotation.y += dt * 3;
          light.intensity = 2 + k * 10;
          return true;
        },
        dispose() { disposeGroup(game.scene, mesh); if (S.nuke === item) S.nuke = null; },
      };
      S.nuke = item;
      game.effects._add(item);
      break;
    }
    case 'nukeEnd': S.nuke?.kill(); break;

    case 'anchor': {
      S.anchor?.kill();
      const mesh = buildRiftMesh();
      mesh.position.set(d.p[0], d.p[1], d.p[2]);
      game.scene.add(mesh);
      let t = Math.min(d.t || 12, 22), done = false;
      const item = {
        kill() { done = true; },
        update(dt) {
          if (done) return false;
          t -= dt;
          mesh.rotation.y += dt * 2.2;
          mesh.scale.setScalar(1 + Math.sin(game.simTime * 5) * 0.08);
          return t > 0;
        },
        dispose() { disposeGroup(game.scene, mesh); if (S.anchor === item) S.anchor = null; },
      };
      S.anchor = item;
      game.effects._add(item);
      break;
    }
    case 'anchorEnd': S.anchor?.kill(); break;
  }
}
