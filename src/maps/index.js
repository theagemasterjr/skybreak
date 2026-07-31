import { CLASSIC } from './classic.js';

// ---------------------------------------------------------------------------
// Map registry. A map def is data (env, islands, platforms, spawns) plus
// optional hooks: build(world, root, rng) for unique geometry and
// makeHazards(world, game) for scripted map hazards. See classic.js for the
// canonical shape.
// ---------------------------------------------------------------------------

export const MAP_DEFS = {
  classic: CLASSIC,
};

// every map id (harness / menus iterate this)
export const MAPS = Object.keys(MAP_DEFS);

// the multiplayer + solo-random pool (training grounds never rolls randomly)
export const MP_MAPS = ['classic'];

export function getMap(id) {
  return MAP_DEFS[id] || CLASSIC;
}

export function randomMapId(rand = Math.random) {
  return MP_MAPS[Math.floor(rand() * MP_MAPS.length)];
}
