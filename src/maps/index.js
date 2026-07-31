import { CLASSIC } from './classic.js';
import { TRAINING } from './training.js';
import { TEMPEST } from './tempest.js';
import { EMBER } from './ember.js';
import { GODSPIRE } from './godspire.js';
import { VOIDGARDEN } from './voidgarden.js';
import { BELT } from './belt.js';

// ---------------------------------------------------------------------------
// Map registry. A map def is data (env, islands, platforms, spawns) plus
// optional hooks: build(world, root, rng) for unique geometry and
// makeHazards(world, game) for scripted map hazards. See classic.js for the
// canonical shape.
// ---------------------------------------------------------------------------

export const MAP_DEFS = {
  classic: CLASSIC,
  training: TRAINING,
  tempest: TEMPEST,
  ember: EMBER,
  godspire: GODSPIRE,
  voidgarden: VOIDGARDEN,
  belt: BELT,
};

// every map id (harness / menus iterate this)
export const MAPS = Object.keys(MAP_DEFS);

// the multiplayer + solo-random pool (training grounds never rolls randomly)
export const MP_MAPS = ['classic', 'tempest', 'ember', 'godspire', 'voidgarden', 'belt'];

export function getMap(id) {
  return MAP_DEFS[id] || CLASSIC;
}

export function randomMapId(rand = Math.random) {
  return MP_MAPS[Math.floor(rand() * MP_MAPS.length)];
}
