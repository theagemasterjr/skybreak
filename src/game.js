import * as THREE from 'three';
import { World } from './world.js';
import { getMap } from './maps/index.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Effects } from './effects.js';
import { Projectiles } from './projectiles.js';
import { PlayerCombat } from './playerCombat.js';
import { Enemy } from './enemies.js';
import { Waves } from './waves.js';
import { HUD } from './hud.js';
import { Menus } from './menus.js';
import { Stats } from './stats.js';
import { GameAudio } from './audio.js';
import { Duel } from './duel.js';
import { BotDuel } from './botDuel.js';
import { Ffa } from './ffa.js';
import { Tutorial } from './tutorial.js';

// ---------------------------------------------------------------------------
// Game: the orchestrator. Owns every subsystem, the game state machine,
// and shared battlefield zones (decoys, smoke clouds, protective domes).
// ---------------------------------------------------------------------------

const _v1 = new THREE.Vector3();

export class Game {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.scene.add(this.camera); // required so viewmodel (camera child) renders

    this.world = null;
    this.loadMap('classic');
    this.input = new Input(canvas);
    this.player = new Player(this.world, this.camera, this.input);
    this.player._simTimeRef = () => this.simTime;   // for out-of-combat regen stamps
    this.effects = new Effects(this.scene);
    this.projectiles = new Projectiles(this.scene, this.world, this.effects);

    // movement juice: hooks from the player controller into VFX
    this.player.onDash = (dir) => {
      this.emitTut('dash');
      this.effects.dashStreaks(this.camera);
      const feet = this.player.position.clone(); feet.y += 0.15;
      this.effects.ring(feet, { color: 0xaadcff, startRadius: 0.3, endRadius: 1.8, life: 0.32, opacity: 0.55, thickness: 0.25 });
      this.effects.burst(feet, { count: 10, color: 0xcfe8ff, speed: 5, size: 0.2, life: 0.3, gravity: 2, direction: dir.clone().negate(), spread: 0.6 });
      this.audio?.play('dash');
    };
    this.player.onJump = (isDouble) => {
      this.emitTut(isDouble ? 'doubleJump' : 'jump');
      const feet = this.player.position.clone(); feet.y += 0.1;
      if (isDouble) {
        this.effects.ring(feet, { color: 0xffffff, startRadius: 0.2, endRadius: 1.3, life: 0.28, opacity: 0.45, thickness: 0.2 });
        this.effects.burst(feet, { count: 8, color: 0xe8f4ff, speed: 4, size: 0.18, life: 0.3, gravity: 3 });
      }
      this.audio?.play(isDouble ? 'doubleJump' : 'jump');
    };
    this.player.onLand = (speed) => {
      this.emitTut('land');
      const feet = this.player.position.clone(); feet.y += 0.1;
      const k = Math.min(1, speed / 30);
      this.effects.burst(feet, {
        count: Math.floor(6 + k * 18), color: 0xbfa78a, color2: 0x8a7a63,
        speed: 3 + k * 6, size: 0.24, life: 0.45, gravity: 6, additive: false,
      });
      if (k > 0.5) this.effects.ring(feet, { color: 0xd9c9aa, startRadius: 0.3, endRadius: 2.5 * k + 1, life: 0.35, opacity: 0.4, thickness: 0.3 });
      this.audio?.play('land');
    };

    this.enemies = [];
    this.combat = null;       // PlayerCombat once a class is chosen
    this.audio = new GameAudio();

    this.simTime = 0;
    this.hitstopT = 0;        // comic-book impact freeze
    this.state = 'menu';      // menu | select | playing | paused | dead
    this.mode = 'solo';       // solo | duel | ffa
    this.currentClassId = 'mage';
    this.runKills = 0;
    this.menuCamAngle = 2.2;

    const uiRoot = document.getElementById('ui-root');
    this.stats = new Stats();
    this.hud = new HUD(this, uiRoot);
    this.duel = new Duel(this);
    this.botDuel = new BotDuel(this);
    this.ffa = new Ffa(this);
    this.menus = new Menus(this, uiRoot);
    this.waves = new Waves(this);
    this.tutorial = new Tutorial(this, uiRoot);

    // online modes: successful casts replicate to rivals as an attack anim
    this.onPlayerCast = (slot, power) => {
      if (this.mode === 'duel') this.duel.notifyCast(slot, power);
      if (this.mode === 'ffa') this.ffa.notifyCast(slot, power);
    };

    // combat feedback -> HUD
    this.onEnemyDamaged = (enemy, dmg) => {
      if (this.state !== 'playing') return;
      const p = enemy.center(new THREE.Vector3());
      p.y += enemy.height * 0.35;
      this.hud.spawnDamageNumber(p, dmg, { big: dmg >= 40 });
      this.hud.hitMarker(false);
    };
    this.onEnemyKilled = (enemy, source) => {
      if (this.state !== 'playing') return;
      this.runKills++;
      this.stats.addKill();
      this.hud.hitMarker(true);
      // kills refund a dash: keeps aerial combos flowing
      this.player.dashCharges = Math.min(this.player.maxDashes, this.player.dashCharges + 1);
      const c = enemy.center(new THREE.Vector3());
      this.effects.impactBurst(c, { size: enemy.elite ? 5.5 : 2.8, color: enemy.elite ? 0xffd76a : 0xffe9a8 });
      this.hitstop(enemy.elite ? 0.13 : 0.05);
      if (enemy.elite) this.hud.flash('rgba(255, 215, 106, 0.16)', 0.28);
    };
    this.player.onDamaged = () => {
      this.hud.damageFlash();
      this.audio?.play('playerHurt');
    };
    this.player.onDeath = () => this._onPlayerDeath();
    this.player.onVoidReset = () => this.hud.damageFlash();

    // pointer-lock loss during a run = pause (solo). A duel can't be paused:
    // the overlay appears but the match keeps running underneath.
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (!locked && this.state === 'playing') {
        if (this.mode === 'duel') this.menus.show('duelpause');
        else if (this.mode === 'ffa') this.menus.show('mppause');
        else this.pause();   // solo AND bot duels: a real pause (bot freezes too)
      } else if (!locked && this.state === 'tutorial') {
        // practicing while dead in an FFA round: Esc opens the room menu, it
        // must NOT desert the room (toMenu would sever the net session)
        if (this.mode === 'ffa' && this.ffa._practice) this.menus.show('mppause');
        else this.toMenu();
      }
    });
    canvas.addEventListener('click', () => {
      if (this.state === 'playing' || this.state === 'tutorial') this.input.requestLock();
    });

    this.menus.show('main');

    // battlefield zones
    this.decoy = null;        // {pos, t, mesh, zapTimer}
    this.smokes = [];         // {pos, r, t, emitTimer}
    this.domes = [];          // {pos, r, t, mesh}

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // the duel-like controller for the current mode (menus route through this)
  get activeDuel() {
    return this.mode === 'botduel' ? this.botDuel : this.duel;
  }

  // tear down the current world and build the given map in its place.
  // hazard seed must match across multiplayer clients (rolled by the host).
  loadMap(mapId, seed = 1) {
    // same map again? reuse the built world — skips a full geometry rebuild
    // (the map-switch hitch) — just re-seed hazards and rewind the clock so
    // multiplayer clients still agree on platform orbits
    if (this.world && this.world.mapDef.id === getMap(mapId).id && !this.world._otMutated) {
      this.world.clock = 0;
      this.world.resetHazards(seed);
      return this.world;
    }
    if (this.world) this.world.dispose();
    this.world = new World(this.scene, getMap(mapId));
    this.world._game = this;
    this.world.resetHazards(seed);
    if (this.player) this.player.world = this.world;
    if (this.projectiles) this.projectiles.world = this.world;
    return this.world;
  }

  // dev shortcut: ?map=tempest in the URL forces solo/tutorial map choice
  _resolveMapParam(mapId) {
    const forced = new URLSearchParams(location.search).get('map');
    return forced || mapId;
  }

  setClass(classId) {
    if (this.combat) this.combat.dispose();
    this.combat = new PlayerCombat(this, classId);
  }

  // tutorial event tap: jumps, dashes, casts, dummy hits (no-op elsewhere)
  emitTut(type, data) {
    if (this.state === 'tutorial') this.tutorial?.onEvent(type, data);
  }

  spawnEnemy(type, pos, opts = {}) {
    const e = new Enemy(this, type, pos, opts);
    this.enemies.push(e);
    return e;
  }

  // ---------- state machine ----------
  showSelect() {
    this.state = 'select';
    this.menus.show('select');
    this.hud.hide();
  }

  toMenu() {
    if (this.state === 'tutorial') this.tutorial.exit();
    if (this.mode === 'botduel') {
      // abandoning a bot duel (pause -> abandon): tear the bot down cleanly
      this.botDuel._dispose();
      this.botDuel.phase = 'idle';
    }
    this._clearBattlefield();
    // keep the last-played world as the menu backdrop: rebuilding classic on
    // every exit was a pointless hitch (and the views are all handsome)
    this.state = 'menu';
    this.mode = 'solo';
    this.menus.show('main');
    this.hud.hide();
    document.exitPointerLock?.();
  }

  startRun(classId, mapId = 'classic') {
    this.currentClassId = classId;
    this._clearBattlefield();
    this.currentMapId = this._resolveMapParam(mapId);   // "FIGHT AGAIN" replays this
    this.loadMap(this.currentMapId, (Math.random() * 1e9) | 0);   // fresh hazard roll per run
    this.setClass(classId);
    this.player.respawn();
    this.player.freeze = false;
    this.input.enabled = true;
    this.runKills = 0;
    this.stats.startRun();
    this.hud.bindClass(this.combat.classDef, this.player.maxDashes);
    this.hud.show();
    this.menus.hideAll();
    this.state = 'playing';
    this.waves.reset();
    this.waves.start();
    this.input.requestLock();
    this.audio?.play('runStart');
  }

  // practice mode: one default class, no waves, no death screen, a couple
  // of stationary dummies to hit. See src/tutorial.js.
  startTutorial(classId = 'mage', scriptId = 'basics', mapId = 'training') {
    this._clearBattlefield();
    this.loadMap(this._resolveMapParam(mapId));
    this.setClass(classId);
    this.player.respawn();
    this.player.freeze = false;
    this.input.enabled = true;
    this.hud.bindClass(this.combat.classDef, this.player.maxDashes);
    this.hud.show();
    this.menus.hideAll();
    this.state = 'tutorial';
    this.mode = 'solo';
    this.waves.reset();
    this.tutorial.start(scriptId);
    this.input.requestLock();
    this.audio?.play('runStart');
  }

  // duel round setup: same as a run but no waves — the opponent is the enemy
  startDuel(classId, mapId = 'classic', seed = 1) {
    this.currentClassId = classId;
    this._clearBattlefield();
    this.loadMap(mapId, seed);
    this.setClass(classId);
    this.player.respawn();
    this.player.freeze = false;
    this.input.enabled = true;
    this.runKills = 0;
    this.hud.bindClass(this.combat.classDef, this.player.maxDashes);
    this.hud.show();
    this.menus.hideAll();
    this.state = 'playing';
    this.mode = 'duel';
    this.waves.reset();
    this.input.requestLock();
    this.audio?.play('runStart');
  }

  // free-for-all round setup: same as a duel round, different referee
  startFfa(classId, mapId = 'classic', seed = 1) {
    this.currentClassId = classId;
    this._clearBattlefield();
    this.loadMap(mapId, seed);
    this.setClass(classId);
    this.player.respawn();
    this.player.freeze = false;
    this.input.enabled = true;
    this.runKills = 0;
    this.hud.bindClass(this.combat.classDef, this.player.maxDashes);
    this.hud.show();
    this.menus.hideAll();
    this.state = 'playing';
    this.mode = 'ffa';
    this.waves.reset();
    this.input.requestLock();
    this.audio?.play('runStart');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.player.freeze = true;
    this.input.enabled = false;
    this.menus.show('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.player.freeze = false;
    this.input.enabled = true;
    this.menus.hideAll();
    this.input.requestLock();
  }

  _onPlayerDeath() {
    if (this.state !== 'playing') return;
    if (this.mode === 'duel') {
      // duels resolve deaths per-round, not with the solo death screen
      this.audio?.play('playerDeath');
      this.duel.localDied();
      return;
    }
    if (this.mode === 'botduel') {
      this.audio?.play('playerDeath');
      this.botDuel.localDied();
      return;
    }
    if (this.mode === 'ffa') {
      this.ffa.localDied();   // handles audio + spectate handoff itself
      return;
    }
    this.state = 'dead';
    this.player.freeze = true;
    const wave = this.waves.wave;
    this._deathResult = {
      wave,
      isNewBest: this.stats.endRun(this.currentClassId, wave),
    };
    this._deathTimer = 0.9; // brief beat before the death screen so the kill reads
    document.exitPointerLock?.();
    this.audio?.play('playerDeath');
  }

  _clearBattlefield() {
    this.playerFx = null;   // multiplayer VFX recorder; duel/ffa re-attach after setup
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
    this.projectiles.clear();
    this.removeDecoy();
    this.smokes.length = 0;
    for (const dm of this.domes) {
      this.scene.remove(dm.mesh);
      dm.mesh.geometry.dispose();
      dm.mat.dispose();
    }
    this.domes.length = 0;
    this.resetCombatState();
  }

  // wipe class runtime state + cooldowns (between duel rounds, on run end)
  resetCombatState() {
    if (!this.combat) return;
    // remove any persistent class objects (rift anchor, focus reticle, ...)
    for (const key of ['anchor', 'focusMesh', 'blue', 'nuke', 'bombObj', 'cobra']) {
      const obj = this.combat.state[key];
      const mesh = obj && obj.mesh ? obj.mesh : obj;
      if (mesh && mesh.isObject3D) {
        this.scene.remove(mesh);
        mesh.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
      }
    }
    // gambler's live pulsar bells (an array of meshes, not a single object)
    for (const b of this.combat.state.bells || []) {
      this.scene.remove(b.mesh);
      b.mesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.combat.state = {};
    this.combat.charging = null;
    this.combat.lockT = 0;
    this.player.damageTakenMult = 1;
    this.player.damageReduction = 0;
    this.player.speedMul = 1;
    // pending delayed casts (meteor call, slot payoffs) must not fire into the
    // next round holding the old, discarded state object
    this.combat.delays.length = 0;
    for (const k in this.combat.cooldowns) this.combat.cooldowns[k] = 0;
  }

  // ---------- zones ----------
  spawnDecoy(pos, duration, power = 0) {
    this.removeDecoy();
    this._decoyPower = power;
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.45, 1.0, 4, 8),
      new THREE.MeshStandardMaterial({
        color: 0x66eaff, emissive: 0x44ccff, emissiveIntensity: 1.6,
        transparent: true, opacity: 0.75, roughness: 0.4,
      })
    );
    body.position.y = 1;
    group.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 8, 6),
      body.material
    );
    head.position.y = 1.95;
    group.add(head);
    const light = new THREE.PointLight(0x66eaff, 5, 9, 2);
    light.position.y = 1.4;
    group.add(light);
    group.position.copy(pos);
    this.scene.add(group);
    this.decoy = { pos: pos.clone(), t: duration, mesh: group, zapTimer: 0.4 };
  }

  removeDecoy(explode = false) {
    if (!this.decoy) return;
    const d = this.decoy;
    if (explode) {
      const pow = this._decoyPower || 0;
      const R = 6.5 + pow * 2;
      const c = d.pos.clone(); c.y += 1;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        _v1.copy(e.position).setY(e.position.y + e.height * 0.5);
        if (_v1.distanceTo(c) < R + e.radius) {
          const kb = _v1.sub(c).normalize().multiplyScalar(10 + 4 * pow).setY(7);
          e.takeDamage(26 * (1 + 0.8 * pow), { knockback: kb, source: 'player' });
        }
      }
      this.effects.ring(c, { color: 0x66eaff, endRadius: R, life: 0.45 });
      this.effects.burst(c, { count: 36, color: 0x88eeff, speed: 13, size: 0.3, life: 0.5 });
      this.effects.impactBurst(c, { color: 0x88eeff, size: 3.5 });
      this.hitstop(0.05);
      this.audio?.play('explosion');
    }
    this.scene.remove(d.mesh);
    d.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.decoy = null;
  }

  spawnSmoke(pos, radius, duration) {
    this.smokes.push({ pos: pos.clone(), r: radius, t: duration, emitTimer: 0 });
    this.effects.burst(pos.clone().add(_v1.set(0, 1, 0)), {
      count: 40, color: 0x555566, color2: 0x222228, speed: 6, size: 1.4,
      life: 1.2, gravity: -0.5, additive: false,
    });
  }

  spawnDome(pos, radius, duration) {
    const geo = new THREE.SphereGeometry(radius, 24, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd76a, transparent: true, opacity: 0.14,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.effects.ring(pos, { color: 0xffd76a, endRadius: radius, life: 0.5 });
    this.domes.push({ pos: pos.clone(), r: radius, t: duration, mesh, mat });
  }

  playerInSmoke() {
    for (const s of this.smokes) {
      if (this.player.position.distanceTo(s.pos) < s.r) return true;
    }
    return false;
  }

  positionInSmoke(p) {
    for (const s of this.smokes) {
      if (p.distanceTo(s.pos) < s.r) return true;
    }
    return false;
  }

  // where enemies should aim their aggression
  threatTarget() {
    if (this.decoy) return this.decoy.pos;
    return this.player.position;
  }

  _updateZones(dt) {
    // decoy
    if (this.decoy) {
      const d = this.decoy;
      d.t -= dt;
      d.mesh.rotation.y += dt * 2;
      d.zapTimer -= dt;
      if (d.zapTimer <= 0) {
        d.zapTimer = 0.5;
        let best = null, bd = 9 * 9;
        for (const e of this.enemies) {
          if (!e.alive) continue;
          const dd = e.position.distanceToSquared(d.pos);
          if (dd < bd) { bd = dd; best = e; }
        }
        if (best) {
          const from = d.pos.clone(); from.y += 1.5;
          const to = best.position.clone(); to.y += best.height * 0.6;
          this.effects.beam(from, to, { color: 0x88eeff, radius: 0.08, life: 0.15 });
          best.takeDamage(4, { source: 'player' });
        }
      }
      if (d.t <= 0) this.removeDecoy(true);
    }
    // smokes
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t -= dt;
      s.emitTimer -= dt;
      if (s.emitTimer <= 0) {
        s.emitTimer = 0.12;
        const p = s.pos.clone();
        p.x += (Math.random() - 0.5) * s.r * 1.5;
        p.z += (Math.random() - 0.5) * s.r * 1.5;
        p.y += Math.random() * 2.5;
        this.effects.glow(p, {
          color: 0x44444f, size: 3.2, life: 0.7, grow: 1.5, additive: false,
        });
      }
      if (s.t <= 0) this.smokes.splice(i, 1);
    }
    // domes
    for (let i = this.domes.length - 1; i >= 0; i--) {
      const dm = this.domes[i];
      dm.t -= dt;
      dm.mat.opacity = 0.1 + Math.sin(this.simTime * 3) * 0.04;
      // heal player inside
      if (this.player.position.distanceTo(dm.pos) < dm.r) {
        this.player.heal(4.5 * dt);
      }
      // destroy enemy projectiles crossing the shell
      for (const p of this.projectiles.list) {
        if (p.owner === 'enemy' && p.pos.distanceTo(dm.pos) < dm.r) {
          p.dead = true;
          this.effects.glow(p.pos, { color: 0xffd76a, size: 0.9, life: 0.2 });
        }
      }
      // slow enemies inside
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (e.position.distanceTo(dm.pos) < dm.r + e.radius) e.slowUntil = this.simTime + 0.15;
      }
      if (dm.t <= 0) {
        this.scene.remove(dm.mesh);
        dm.mesh.geometry.dispose();
        dm.mat.dispose();
        this.domes.splice(i, 1);
      }
    }
  }

  hitstop(t) {
    this.hitstopT = Math.max(this.hitstopT, t);
  }

  // ---------- main tick ----------
  tick(dt) {
    // room networking stays alive through every state (lobby sits over menus)
    this.ffa.tickAlways(dt);
    // world clocks run on UNSCALED dt: hitstop is local juice and must never
    // drift platform orbits / hazard schedules apart between online clients
    this.world.advanceClocks(dt, this.state);
    // hitstop: the world freezes for a beat on heavy impacts
    if (this.hitstopT > 0) {
      this.hitstopT -= dt;
      dt *= 0.07;
    }
    this.simTime += dt;
    const t = this.simTime;

    this.world.update(dt, t);

    // menu states: cinematic camera drifting around the arena
    if (this.state === 'menu' || this.state === 'select') {
      this.menuCamAngle += dt * 0.04;
      const a = this.menuCamAngle;
      this.camera.position.set(Math.cos(a) * 58, 16 + Math.sin(t * 0.1) * 5, Math.sin(a) * 58);
      this.camera.lookAt(0, 3, 0);
      this.effects.update(dt);
      this.input.endFrame();
      return;
    }

    // paused: freeze the simulation, keep the frame alive
    if (this.state === 'paused') {
      this.hud.update(dt, t);
      this.input.endFrame();
      return;
    }

    // death beat -> death screen
    if (this.state === 'dead' && this._deathTimer > 0) {
      this._deathTimer -= dt;
      if (this._deathTimer <= 0) {
        this.menus.showDeath(
          this._deathResult.wave, this.runKills,
          this.stats.bestFor(this.currentClassId), this._deathResult.isNewBest
        );
        this.hud.hide();
      }
    }

    if (this.mode === 'duel') this.duel.update(dt);
    if (this.mode === 'botduel') this.botDuel.update(dt);
    if (this.mode === 'ffa') this.ffa.update(dt);

    this.player.update(dt, t);
    if (this.combat) this.combat.update(dt, t);
    // shielder pre-pass: assign protection auras before enemies act
    for (const e of this.enemies) e.shieldedBy = null;
    for (const s of this.enemies) {
      if (s.type !== 'shielder' || !s.alive) continue;
      for (const e of this.enemies) {
        if (e === s || !e.alive) continue;
        if (e.position.distanceTo(s.position) < 9) e.shieldedBy = s;
      }
    }
    for (const e of this.enemies) e.update(dt, t);
    // sweep dead enemies after their death animation finishes
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].readyToRemove) {
        this.enemies[i].dispose();
        this.enemies.splice(i, 1);
      }
    }
    this.projectiles.update(dt, t, this.enemies, this.player);
    this._updateZones(dt);
    this.effects.update(dt);
    if (this.waves) this.waves.update(dt, t);
    if (this.hud) this.hud.update(dt, t);
    if (this.state === 'tutorial') this.tutorial.update(dt, t);
    // spectate camera must win over the dead player's own camera
    if (this.mode === 'ffa') this.ffa.lateUpdate(dt);

    this.input.endFrame();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
