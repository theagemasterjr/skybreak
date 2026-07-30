// Self-check for the fxNet replication layer: record -> serialize -> replay,
// plus persistent prop lifecycle (blue orb / nuke / anchor).
import * as THREE from 'three';
import { recordingEffects, applyFx, killFxProps } from '../src/fxNet.js';

// ---- stub effects manager (same surface as Effects) ----
function stubEffects() {
  const calls = [];
  const items = [];
  return {
    calls, items,
    _add(i) { items.push(i); },
    update(dt) {
      for (let i = items.length - 1; i >= 0; i--) {
        if (!items[i].update(dt)) { items[i].dispose(); items.splice(i, 1); }
      }
    },
    burst(p, o) { calls.push(['burst', p.clone(), o]); },
    glow(p, o) { calls.push(['glow', p.clone(), o]); return {}; },
    beam(a, b, o) { calls.push(['beam', a.clone(), b.clone(), o]); },
    ring(p, o) { calls.push(['ring', p.clone(), o]); },
    marker(p, o) { calls.push(['marker', p.clone(), o]); },
    impactBurst(p, o) { calls.push(['impact', p.clone(), o]); },
    dashStreaks() { calls.push(['dash']); },
  };
}

const senderFx = stubEffects();
const buf = [];
const rec = recordingEffects(senderFx, buf);

const P = new THREE.Vector3(1, 2, 3);
const Q = new THREE.Vector3(4, 5, 6);
rec.burst(P, { count: 10, color: 0xff9944, direction: new THREE.Vector3(0, 1, 0), spread: 0.5 });
rec.glow(P, { color: 0x66ccff, size: 1.2, life: 0.2 });
rec.beam(P, Q, { color: 0x88eeff, radius: 0.07, life: 0.1 });
rec.ring(P, { color: 0xaaf2ff, endRadius: 8, axis: 'x', thickness: 0.3 });
rec.marker(P, { color: 0xff6633, radius: 6.5, life: 0.85 });
rec.impactBurst(P, { color: 0xffb266, size: 3 });
rec.dashStreaks(null);
rec.prop('anchor', { p: [1, 2, 3], t: 12 });

console.assert(senderFx.calls.length === 7, 'local playback ran for every call');
console.assert(buf.length === 7, `buffer has 7 events (dashStreaks local-only), got ${buf.length}`);
console.assert(buf[0].o.dir && buf[0].o.dir[1] === 1, 'direction vector serialized');
console.assert(buf[3].o.axis === 'x', 'axis serialized');

// simulate the wire: JSON round-trip like PeerJS would
const wire = JSON.parse(JSON.stringify(buf.splice(0)));

// ---- receiving side ----
const rxFx = stubEffects();
const game = { effects: rxFx, simTime: 0, scene: { added: [], add(m) { this.added.push(m); }, remove(m) { this.added.splice(this.added.indexOf(m), 1); } } };
const avatar = { alive: true, position: new THREE.Vector3(0, 4, -22), net: { yaw: 0, pitch: 0 } };

applyFx(game, wire, avatar);
console.assert(rxFx.calls.length === 6, `receiver replayed 6 effects, got ${rxFx.calls.length}`);
console.assert(rxFx.calls[0][2].direction instanceof THREE.Vector3, 'direction rebuilt as Vector3');
console.assert(rxFx.calls[2][0] === 'beam' && rxFx.calls[2][3].radius === 0.07
  && rxFx.calls[2][2].y === 5, 'beam endpoints+opts survive');
console.assert(game.scene.added.length === 1, 'anchor prop mesh added to scene');
console.assert(avatar.fxProps.anchor, 'anchor tracked on avatar');

// anchor expires on its own
for (let i = 0; i < 130; i++) rxFx.update(0.1); // 13s > 12s ttl
console.assert(game.scene.added.length === 0, 'anchor mesh removed after ttl');
console.assert(!avatar.fxProps.anchor, 'anchor slot cleared');

// ---- blue orb: spawn, drift, early kill via blueEnd ----
applyFx(game, JSON.parse(JSON.stringify([{ f: 'prop', k: 'blue', d: { p: [0, 5, 0], v: [14, 0, 0], t: 5, r: 9 } }])), avatar);
console.assert(game.scene.added.length === 1, 'blue orb mesh added');
const orbMesh = game.scene.added[0];
const x0 = orbMesh.position.x;
rxFx.update(0.5);
console.assert(orbMesh.position.x > x0 + 6.9, `blue orb drifts (+${(orbMesh.position.x - x0).toFixed(2)})`);
applyFx(game, [{ f: 'prop', k: 'blueEnd' }], avatar);
rxFx.update(0.016);
console.assert(game.scene.added.length === 0, 'blueEnd removes the orb');

// ---- nuke: attaches in front of avatar, dies with avatar ----
applyFx(game, [{ f: 'prop', k: 'nuke' }], avatar);
rxFx.update(0.1);
const nukeMesh = game.scene.added[0];
console.assert(nukeMesh, 'nuke orb added');
console.assert(Math.abs(nukeMesh.position.z - (avatar.position.z - 2.6)) < 0.4, `nuke hangs in front of avatar (z=${nukeMesh.position.z.toFixed(2)}, expected ~${(avatar.position.z - 2.6).toFixed(2)})`);
avatar.alive = false;
rxFx.update(0.016);
console.assert(game.scene.added.length === 0, 'nuke orb removed when avatar dies');
avatar.alive = true;

// ---- killFxProps cleans up everything live ----
applyFx(game, [{ f: 'prop', k: 'blue', d: { p: [0, 5, 0], v: [0, 0, 0], t: 5, r: 8 } },
               { f: 'prop', k: 'anchor', d: { p: [0, 0, 0], t: 12 } }], avatar);
console.assert(game.scene.added.length === 2, 'two live props');
killFxProps(avatar);
rxFx.update(0.016);
console.assert(game.scene.added.length === 0, 'killFxProps removed both');

// ---- overflow cap ----
const buf2 = [];
const rec2 = recordingEffects(stubEffects(), buf2);
for (let i = 0; i < 100; i++) rec2.glow(P, { size: 1 });
console.assert(buf2.length === 64, `buffer capped at 64, got ${buf2.length}`);

console.log('ALL FXNET CHECKS PASSED');
