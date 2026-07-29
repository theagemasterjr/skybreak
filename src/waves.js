import * as THREE from 'three';
import { ENEMY_TYPES } from './enemies.js';

// ---------------------------------------------------------------------------
// Waves: endless spawn director. Each wave has a point budget spent on a
// weighted shop of enemy types (harder types unlock on later waves).
// Spawns arrive in staggered groups around the player's island.
// ---------------------------------------------------------------------------

const SHOP = [
  { type: 'rusher',   cost: 1,   minWave: 1 },
  { type: 'flyer',    cost: 1.2, minWave: 2 },
  { type: 'flyer',    cost: 1.2, minWave: 4 },   // double weight: the sky fills up
  { type: 'sniper',   cost: 1.5, minWave: 2 },
  { type: 'wraith',   cost: 1.4, minWave: 3 },
  { type: 'bomber',   cost: 1.5, minWave: 4 },
  { type: 'swarmling', cost: 2.4, minWave: 4 },  // one pick spawns a whole pack — see _nextWave
  { type: 'blinker',  cost: 2,   minWave: 5 },
  { type: 'shielder', cost: 2.5, minWave: 6 },
];

const SWARM_PACK = [4, 6]; // [min, max] swarmlings spawned per 'swarmling' pick
const FLYING_SPAWN_TYPES = new Set(['flyer', 'wraith', 'swarmling', 'sentinel']);

const MAX_ALIVE = 13;

export class Waves {
  constructor(game) {
    this.game = game;
    this.wave = 0;
    this.queue = [];         // enemy types waiting to spawn
    this.spawnTimer = 0;
    this.betweenTimer = 0;
    this.state = 'idle';     // idle | spawning | fighting | between
    this.aliveCount = 0;
  }

  reset() {
    this.wave = 0;
    this.queue = [];
    this.state = 'idle';
    this.betweenTimer = 0;
  }

  start() {
    this.wave = 0;
    this._nextWave();
  }

  _nextWave() {
    this.wave++;
    const w = this.wave;
    const budget = 3 + w * 1.7;
    const picks = [];

    // guaranteed elites on a cadence
    if (w >= 7 && (w - 7) % 3 === 0) picks.push('knight');
    if (w >= 9 && (w - 9) % 3 === 0) picks.push('golem');
    if (w >= 12 && (w - 12) % 4 === 0) picks.push('sentinel');
    if (w >= 14 && w % 5 === 0) picks.push(['knight', 'golem', 'sentinel'][Math.floor(Math.random() * 3)]);
    // aerial pressure: guaranteed flyers so air combat stays central
    if (w >= 3) picks.push('flyer');
    if (w >= 6) picks.push('flyer');

    const available = SHOP.filter((s) => w >= s.minWave);
    let left = budget;
    let guard = 60;
    while (left > 0.9 && guard-- > 0) {
      const pick = available[Math.floor(Math.random() * available.length)];
      if (pick.cost > left + 0.5) continue;
      if (pick.type === 'swarmling') {
        // one pick = a whole pack, so a flock reads as a single "threat" for budget purposes
        const n = SWARM_PACK[0] + Math.floor(Math.random() * (SWARM_PACK[1] - SWARM_PACK[0] + 1));
        for (let i = 0; i < n; i++) picks.push('swarmling');
      } else {
        picks.push(pick.type);
      }
      left -= pick.cost;
    }
    // shuffle so elites aren't always first
    for (let i = picks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [picks[i], picks[j]] = [picks[j], picks[i]];
    }
    this.queue = picks;
    this.state = 'spawning';
    this.spawnTimer = 1.2;
    if (this.game.hud) this.game.hud.announceWave(w);
    this.game.audio?.play('waveStart');
  }

  // spawn position: around the island nearest the player, at its edge
  _spawnPos(type) {
    const g = this.game;
    const p = g.player.position;
    // pick the island the player is closest to
    let island = g.world.islands[0];
    let bd = Infinity;
    for (const isl of g.world.islands) {
      const d = Math.hypot(p.x - isl.x, p.z - isl.z);
      if (d < bd) { bd = d; island = isl; }
    }
    const a = Math.random() * Math.PI * 2;
    const r = island.R * (0.55 + Math.random() * 0.3);
    const x = island.x + Math.cos(a) * r;
    const z = island.z + Math.sin(a) * r;
    let y = island.topY + 2;
    if (FLYING_SPAWN_TYPES.has(type)) y += 7 + Math.random() * 4;
    const pos = new THREE.Vector3(x, y, z);
    // don't spawn right on top of the player
    if (pos.distanceTo(p) < 8) {
      pos.x = island.x - Math.cos(a) * r;
      pos.z = island.z - Math.sin(a) * r;
    }
    return pos;
  }

  update(dt) {
    const g = this.game;
    if (g.state !== 'playing') return;

    this.aliveCount = g.enemies.filter((e) => e.alive).length;

    if (this.state === 'spawning' || this.state === 'fighting') {
      // trickle the queue in
      if (this.queue.length > 0) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0 && this.aliveCount < MAX_ALIVE) {
          const type = this.queue.shift();
          const hpMul = 1 + (this.wave - 1) * 0.13;
          const dmgMul = 1 + (this.wave - 1) * 0.055;
          g.spawnEnemy(type, this._spawnPos(type), { hpMul, dmgMul });
          this.spawnTimer = 0.55 + Math.random() * 0.7;
        }
      } else {
        this.state = 'fighting';
      }
      // wave cleared?
      if (this.queue.length === 0 && this.aliveCount === 0 && this.state === 'fighting') {
        this.state = 'between';
        this.betweenTimer = 3.8;
        // reward: recover 35% of missing health
        const p = g.player;
        p.heal((p.maxHealth - p.health) * 0.35);
        if (g.hud) g.hud.announceCleared(this.wave);
        g.audio?.play('waveClear');
      }
    } else if (this.state === 'between') {
      this.betweenTimer -= dt;
      if (this.betweenTimer <= 0) this._nextWave();
    }
  }

  remaining() {
    return this.aliveCount + this.queue.length;
  }
}
