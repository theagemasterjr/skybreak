import { Game } from './game.js';
import { preloadEnemyModels } from './enemyAssets.js';
import { preloadChampionModels } from './championAssets.js';

const canvas = document.getElementById('game-canvas');
const game = new Game(canvas);
// fire-and-forget: enemies/players fall back to procedural models until these arrive
preloadEnemyModels();
preloadChampionModels();

let last = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  game.tick(dt);
  game.render();
}
requestAnimationFrame(animate);

// deterministic stepper for automated tests (works while the tab is hidden)
function step(dt = 1 / 60, n = 1) {
  for (let i = 0; i < n; i++) game.tick(dt);
  game.render();
}

window.SKYBREAK = { game, step };
console.log('[SKYBREAK] full game running');
