import * as THREE from 'three';
import { RoomNet, scanRooms, MAX_PLAYERS } from './roomNet.js';
import { DuelOpponent } from './duelOpponent.js';

// ---------------------------------------------------------------------------
// Ffa: free-for-all rooms. A named room holds up to 4 players; the creator
// relays traffic (see roomNet.js). Rounds are last-one-standing: dead players
// spectate their killer in third person (chaining to the killer's killer),
// then everyone returns to the room lobby with a win-count scoreboard.
//
// Same netcode model as the 1v1 duel: every client simulates only its own
// player; 20Hz snapshots animate everyone else's avatar; damage is shooter-
// authoritative (my hit on your avatar -> targeted hit event -> you apply it
// to yourself, piercing local i-frames). The HOST additionally referees:
// declares round start, round end, and win counts.
// ---------------------------------------------------------------------------

const SEND_INTERVAL = 0.05;    // 20Hz snapshots
const KILL_CREDIT_T = 8;       // s after a hit that the attacker owns your death
const SPAWNS = [
  { pos: [0, 4.5, 22], yaw: 0 },
  { pos: [0, 4.5, -22], yaw: Math.PI },
  { pos: [22, 4.5, 0], yaw: Math.PI / 2 },
  { pos: [-22, 4.5, 0], yaw: -Math.PI / 2 },
];

const _v1 = new THREE.Vector3();

export class Ffa {
  constructor(game) {
    this.game = game;
    this.net = null;
    this.phase = 'idle';       // idle | lobby | countdown | fighting | roundover
    this.round = 0;
    this.avatars = new Map();  // playerId -> DuelOpponent
    this.aliveIds = new Set();
    this.killerOf = new Map(); // victimId -> killerId|null
    this._scan = null;

    this._sendT = 0;
    this._cdT = 0; this._cdLast = -1;
    this._overT = 0;
    this._endGraceT = 0;       // host: grace before declaring the winner
    this._backT = 0;
    this._lastAttacker = null; // {id, t}
    this._baseWalkSpeed = 0;
    this._slowT = 0;
    this._poison = null;

    // spectate
    this.spectateId = null;
    this.specYaw = 0;
    this.specPitch = -0.15;
  }

  get active() { return this.phase !== 'idle'; }
  get inRoom() { return !!this.net && this.net.live; }
  get isHost() { return this.net ? this.net.isHost : false; }
  canDealDamage() { return this.phase === 'fighting'; }

  myName() { return `PLAYER ${this.net.meId + 1}`; }
  nameOf(id) {
    const p = this.net?.player(id);
    return (p && p.data.name) || `PLAYER ${id + 1}`;
  }

  // ---------------- room browsing ----------------
  refreshRooms() {
    if (this._scan) this._scan.cancel();
    if (!window.Peer) { this.game.menus.setRoomList([]); this.game.menus.setMpStatus('NO CONNECTION'); return; }
    this.game.menus.setRoomList(null);   // null = scanning spinner
    this._scan = scanRooms((rooms) => {
      this._scan = null;
      this.game.menus.setRoomList(rooms);
    });
  }

  stopBrowsing() {
    if (this._scan) { this._scan.cancel(); this._scan = null; }
  }

  // ---------------- create / join / leave ----------------
  createRoom(roomName) {
    if (this.inRoom || !window.Peer) return;
    this._openNet();
    this.net.createRoom(roomName || 'SKY ARENA', { name: 'PLAYER 1', cls: null, wins: 0 });
    this.game.menus.setMpStatus('OPENING ROOM…');
  }

  joinRoom(slot) {
    if (this.inRoom || !window.Peer) return;
    this._openNet();
    this.net.joinRoom(slot, { name: 'PLAYER', cls: null, wins: 0 });
    this.game.menus.setMpStatus('JOINING…');
  }

  _openNet() {
    this.stopBrowsing();
    this.net = new RoomNet();
    this.net.onStatus = (s) => this.game.menus.setMpStatus(s);
    this.net.onRoster = () => this._onRoster();
    this.net.onMessage = (f, m) => this._onMessage(f, m);
    this.net.onPlayerLost = (id) => this._onPlayerLost(id);
    this.net.onMigrating = () => {
      if (this.phase === 'fighting' || this.phase === 'countdown') {
        this.game.hud.announce('STORM IN THE LINK…', 'sub');
      }
    };
    this.net.onMigrated = () => {
      if (this.isHost) {
        this.net.roomInfoExtra.inRound = this.phase !== 'lobby' && this.phase !== 'idle';
        this._checkRoundEnd();   // referee duty may have changed hands mid-fight
      }
      if (this.phase === 'fighting' || this.phase === 'countdown') {
        this.game.hud.announce('LINK RESTORED', 'sub');
      } else if (this.phase === 'lobby') {
        this.game.menus.renderLobby(this.lobbyState());
      }
    };
    this.net.onClosed = (reason) => this._roomClosed(reason);
  }

  leaveRoom() {
    if (this.net) { this.net.leave(); this.net = null; }
    this._exitToMenu(null);
  }

  _roomClosed(reason) {
    this.net = null;
    this._exitToMenu(reason);
  }

  _exitToMenu(reason) {
    this._disposeAvatars();
    const g = this.game;
    this.phase = 'idle';
    g.projectiles.onSpawn = null;
    if (this._baseWalkSpeed) g.player.walkSpeed = this._baseWalkSpeed;
    g.player.suppressCamera = false;
    if (g.combat) g.combat.viewmodel.group.visible = true;
    g.hud.setSpectating?.(null);
    g.mode = 'solo';
    g.toMenu();
    g.menus.show('mp');
    if (reason) g.menus.setMpStatus(reason);
    g.menus.refreshMpScreen?.();
  }

  // ---------------- roster / lobby ----------------
  _onRoster() {
    if (!this.net) return;
    // first roster after create/join: land in the lobby
    if (this.phase === 'idle') {
      this.phase = 'lobby';
      this.net.updateMyData({ name: `PLAYER ${this.net.meId + 1}` });
      this.game.menus.showLobby();
    }
    if (this.phase === 'lobby') this.game.menus.renderLobby(this.lobbyState());
    // host mid-round: tell fresh joiners so their lobby says "round running"
    const ids = new Set(this.net.roster.map((p) => p.id));
    if (this.isHost && this.phase !== 'lobby' && this.phase !== 'idle') {
      this.net.roomInfoExtra.inRound = true;
      for (const id of ids) {
        if (!this._knownIds?.has(id) && id !== this.net.meId) {
          this.net.sendTo(id, { t: 'midround' });
        }
      }
    }
    this._knownIds = ids;
  }

  lobbyState() {
    const n = this.net;
    if (!n) return null;
    return {
      roomName: n.roomName,
      meId: n.meId,
      hostId: n.hostId,
      isHost: n.isHost,
      // a mid-round joiner sits in the lobby while others fight: report the
      // room's real phase so the lobby shows "round in progress"
      phase: this._midRound ? 'fighting' : this.phase,
      minPlayers: 2,
      maxPlayers: MAX_PLAYERS,
      players: n.roster.map((p) => ({
        id: p.id,
        name: p.data.name || `PLAYER ${p.id + 1}`,
        cls: p.data.cls || null,
        wins: p.data.wins || 0,
        isHost: p.id === n.hostId,
        me: p.id === n.meId,
      })),
    };
  }

  pickClass(classId) {
    if (!this.inRoom || this.phase !== 'lobby') return;
    this.net.updateMyData({ cls: classId });
    this.game.menus.showLobby();
    this.game.menus.renderLobby(this.lobbyState());
  }

  // host presses START in the lobby
  startRound() {
    if (!this.isHost || this.phase !== 'lobby') return;
    if (this.net.roster.length < 2) return;
    this.round++;
    const spawns = {};
    this.net.roster.forEach((p, i) => { spawns[p.id] = SPAWNS[i % SPAWNS.length]; });
    this.net.send({ t: 'start', round: this.round, spawns });
    this._beginRound(this.round, spawns);
  }

  _beginRound(round, spawns) {
    const g = this.game;
    this.round = round;
    this.phase = 'countdown';
    this._cdT = 3.6;
    this._cdLast = 99;
    this._endGraceT = 0;
    this._poison = null;
    this._slowT = 0;
    this._lastAttacker = null;
    this.spectateId = null;
    this.killerOf.clear();
    if (this.isHost) this.net.roomInfoExtra.inRound = true;

    const myClass = this.net.me()?.data.cls || 'mage';
    g.startFfa(myClass);
    g.projectiles.onSpawn = (o) => this._sendProjectile(o);
    this._baseWalkSpeed = g.player.walkSpeed;

    // avatars for everyone else in the roster
    this._disposeAvatars();
    this.aliveIds = new Set();
    for (const p of this.net.roster) {
      this.aliveIds.add(p.id);
      if (p.id === this.net.meId) continue;
      const av = new DuelOpponent(g, this, p.data.cls || 'mage', {
        netId: p.id, name: p.data.name || `PLAYER ${p.id + 1}`,
      });
      const sp = spawns[p.id] || SPAWNS[0];
      av.respawn(_v1.set(sp.pos[0], sp.pos[1], sp.pos[2]), sp.yaw);
      this.avatars.set(p.id, av);
      g.enemies.push(av);
    }

    const mine = spawns[this.net.meId] || SPAWNS[0];
    g.player.suppressCamera = false;
    g.player.respawn();
    g.player.position.set(mine.pos[0], mine.pos[1], mine.pos[2]);
    g.player.yaw = mine.yaw;
    g.player.pitch = 0;
    g.player.freeze = true;
    if (g.combat) g.combat.viewmodel.group.visible = true;
    g.hud.setSpectating?.(null);
    g.hud.announce(`ROUND ${round}`, '');
  }

  // ---------------- per-frame ----------------
  // runs every tick regardless of game state (lobby included): net upkeep
  tickAlways(dt) {
    if (this.net) this.net.update(dt);
  }

  // runs from Game.tick while mode === 'ffa'
  update(dt) {
    if (!this.active || !this.net) return;
    const g = this.game;

    if (this.phase === 'countdown') {
      this._sendState(dt);
      this._cdT -= dt;
      const sec = Math.ceil(this._cdT);
      if (sec !== this._cdLast && sec >= 1 && sec <= 3) {
        this._cdLast = sec;
        g.hud.announce(String(sec), 'sub');
        g.audio?.play('chargeStart');
      }
      if (this._cdT <= 0) {
        this.phase = 'fighting';
        g.player.freeze = false;
        g.hud.announce('LAST ONE FLYING WINS', '');
        g.audio?.play('runStart');
      }
      return;
    }

    if (this.phase === 'fighting') {
      this._sendState(dt);
      // kill credit fades: an old scratch shouldn't own a void fall minutes later
      if (this._lastAttacker) {
        this._lastAttacker.t -= dt;
        if (this._lastAttacker.t <= 0) this._lastAttacker = null;
      }

      // incoming slow / poison (same as duel)
      if (this._slowT > 0) {
        this._slowT -= dt;
        g.player.walkSpeed = this._baseWalkSpeed * 0.55;
      } else if (this._baseWalkSpeed) {
        g.player.walkSpeed = this._baseWalkSpeed;
      }
      if (this._poison && g.player.alive) {
        this._poison.t -= dt;
        g.player.health -= this._poison.dps * dt;
        if (g.player.health <= 0) {
          g.player.health = 0;
          g.player.alive = false;
          if (g.player.onDeath) g.player.onDeath();
        }
        if (this._poison.t <= 0) this._poison = null;
      }

      // void death
      if (g.player.alive && g.player.position.y < -95) {
        g.player.alive = false;
        this.localDied();
      }

      // host referee: end the round when at most one player stands
      if (this.isHost && this._endGraceT > 0) {
        this._endGraceT -= dt;
        if (this._endGraceT <= 0) this._declareWinner();
      }
      return;
    }

    if (this.phase === 'roundover') {
      this._sendState(dt);
      this._overT -= dt;
      if (this._overT <= 0) {
        this._overT = 999;   // fire once; host sends everyone back
        if (this.isHost) {
          this.net.send({ t: 'back' });
          this._toLobby();
        }
      }
      return;
    }
  }

  // camera override after all systems ran: third-person spectate
  lateUpdate(dt) {
    if (this.phase !== 'fighting' && this.phase !== 'roundover') return;
    const g = this.game;
    if (g.player.alive || this.spectateId === null) return;

    let target = this.avatars.get(this.spectateId);
    if (!target || !target.alive) {
      this._retargetSpectate();
      target = this.avatars.get(this.spectateId);
      if (!target) return;
    }

    // orbit with the mouse (the dead player controller no longer consumes look)
    const [dx, dy] = g.input.consumeLook();
    this.specYaw -= dx * g.player.sensitivity;
    this.specPitch = Math.max(-1.2, Math.min(0.9, this.specPitch - dy * g.player.sensitivity));

    const head = _v1.copy(target.position); head.y += target.height * 0.75;
    const dist = 6.5;
    const cp = Math.cos(this.specPitch), sp = Math.sin(this.specPitch);
    const off = new THREE.Vector3(
      Math.sin(this.specYaw) * cp * dist,
      -sp * dist + 1.2,
      Math.cos(this.specYaw) * cp * dist
    );
    const want = head.clone().add(off);
    g.camera.position.lerp(want, 1 - Math.exp(-12 * dt));
    g.camera.lookAt(head);
  }

  _setSpectate(id) {
    this.spectateId = id;
    this.game.hud.setSpectating?.(this.nameOf(id));
    // keep the view continuous: start the orbit from where the camera is now
    const t = this.avatars.get(id);
    if (t) {
      const cam = this.game.camera.position;
      this.specYaw = Math.atan2(cam.x - t.position.x, cam.z - t.position.z);
    }
  }

  _retargetSpectate() {
    // chain: whoever killed my current target; else any living player
    let next = this.spectateId !== null ? this.killerOf.get(this.spectateId) : null;
    if (next === undefined) next = null;
    if (next === this.net.meId) next = null;             // I can't spectate myself
    if (next === null || !this.aliveIds.has(next)) {
      next = [...this.aliveIds].find((id) => id !== this.net.meId) ?? null;
    }
    if (next !== null && next !== this.spectateId) this._setSpectate(next);
  }

  // ---------------- snapshots / messages ----------------
  _sendState(dt) {
    this._sendT -= dt;
    if (this._sendT > 0) return;
    this._sendT = SEND_INTERVAL;
    const g = this.game;
    const p = g.player;
    this.net.send({
      t: 's',
      p: [+p.position.x.toFixed(2), +p.position.y.toFixed(2), +p.position.z.toFixed(2)],
      v: [+p.vel.x.toFixed(2), +p.vel.y.toFixed(2), +p.vel.z.toFixed(2)],
      yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3),
      g: p.grounded ? 1 : 0,
      d: p.dashTimer > 0 ? 1 : 0,
      c: g.combat && g.combat.charging ? 1 : 0,
      hp: Math.round(p.health), mh: p.maxHealth, sh: Math.round(p.shield),
    });
  }

  _onMessage(fromId, m) {
    switch (m.t) {
      case 's': {
        const av = this.avatars.get(fromId);
        if (av) av.applySnapshot(m);
        break;
      }
      case 'cast': {
        const av = this.avatars.get(fromId);
        if (av && av.alive) av.playAttack();
        break;
      }
      case 'proj':
        this._spawnRemoteProjectile(m.o);
        break;
      case 'hit':
        this._applyHit(m, fromId);
        break;
      case 'died':
        this._onRemoteDied(fromId, m.k);
        break;
      case 'start':
        this._midRound = false;
        if (this.phase === 'lobby') this._beginRound(m.round, m.spawns);
        break;
      case 'over':
        this._roundOver(m.w);
        break;
      case 'back':
        this._midRound = false;
        if (this.phase !== 'lobby') this._toLobby();
        else this.game.menus.renderLobby(this.lobbyState());
        break;
      case 'midround':
        this._midRound = true;
        if (this.phase === 'lobby') this.game.menus.renderLobby(this.lobbyState());
        break;
    }
  }

  // ---------------- damage ----------------
  // DuelOpponent hook: my attack landed on avatar `av` in MY world
  sendHitFor(av, dmg, knockback, freeze, poison, slow) {
    if (av.netId < 0) return;
    this.net.sendTo(av.netId, {
      t: 'hit',
      d: +dmg.toFixed(1),
      k: knockback ? [+knockback.x.toFixed(2), +knockback.y.toFixed(2), +knockback.z.toFixed(2)] : null,
      f: freeze || 0,
      po: poison ? { dps: poison.dps, t: poison.t } : null,
      sl: slow || 0,
    });
  }

  _applyHit(m, fromId) {
    if (this.phase !== 'fighting') return;
    const g = this.game;
    const p = g.player;
    if (!p.alive) return;
    this._lastAttacker = { id: fromId, t: KILL_CREDIT_T };
    const av = this.avatars.get(fromId);
    p.takeDamage(m.d, av ? av.position : null, { pierceInvuln: true });
    if (m.k) p.applyKnockback(new THREE.Vector3(m.k[0], m.k[1], m.k[2]));
    if (m.f > 0) p.root(m.f);
    if (m.sl > 0) this._slowT = Math.max(this._slowT, m.sl);
    if (m.po) {
      this._poison = {
        t: Math.max(this._poison ? this._poison.t : 0, m.po.t),
        dps: Math.max(this._poison ? this._poison.dps : 0, m.po.dps),
      };
    }
  }

  _sendProjectile(o) {
    if (this.phase !== 'fighting' && this.phase !== 'roundover') return;
    this.net.send({
      t: 'proj',
      o: {
        p: [+o.pos.x.toFixed(2), +o.pos.y.toFixed(2), +o.pos.z.toFixed(2)],
        v: [+o.vel.x.toFixed(2), +o.vel.y.toFixed(2), +o.vel.z.toFixed(2)],
        color: o.color, coreColor: o.coreColor, size: o.size, radius: o.radius,
        gravity: o.gravity || 0, life: o.life, aoe: o.aoe || 0,
      },
    });
  }

  _spawnRemoteProjectile(o) {
    if (!o || !this.game.combat) return;
    this.game.projectiles.spawn({
      pos: new THREE.Vector3(o.p[0], o.p[1], o.p[2]),
      vel: new THREE.Vector3(o.v[0], o.v[1], o.v[2]),
      owner: 'remote', damage: 0, knockback: 0,
      color: o.color, coreColor: o.coreColor, size: o.size, radius: o.radius,
      gravity: o.gravity, life: Math.min(o.life ?? 3.5, 6), aoe: o.aoe,
    });
  }

  notifyCast(slot, power) {
    if (!this.active || !this.net) return;
    if (this.phase !== 'fighting' && this.phase !== 'countdown') return;
    this.net.send({ t: 'cast', slot, p: power || 0 });
  }

  // ---------------- deaths ----------------
  // my player died (combat damage, poison, or the void)
  localDied() {
    if (this.phase !== 'fighting') return;
    const g = this.game;
    const meId = this.net.meId;
    const killer = (this._lastAttacker && this._lastAttacker.t > 0) ? this._lastAttacker.id : null;
    this.aliveIds.delete(meId);
    this.killerOf.set(meId, killer);
    this.net.send({ t: 'died', k: killer });
    g.audio?.play('playerDeath');
    // into the spectator's chair: hide my hands, own the camera, follow my killer
    if (g.combat) g.combat.viewmodel.group.visible = false;
    g.player.suppressCamera = true;
    this.spectateId = null;
    // spectate my actual killer when they're still standing; only fall back
    // to the chain/any-survivor search when there's no killer to follow
    if (killer !== null && this.aliveIds.has(killer)) this._setSpectate(killer);
    else this._retargetSpectate();
    if (this.isHost) this._checkRoundEnd();
  }

  _onRemoteDied(victimId, killerId) {
    if (this.phase !== 'fighting') return;
    this.aliveIds.delete(victimId);
    this.killerOf.set(victimId, killerId ?? null);
    const av = this.avatars.get(victimId);
    if (av) av.die();
    const kName = killerId !== null && killerId !== undefined ? this.nameOf(killerId) : 'THE VOID';
    this.game.hud.announce(`${kName} DOWNED ${this.nameOf(victimId)}`, 'sub');
    // my spectate target fell: follow their killer
    if (!this.game.player.alive && this.spectateId === victimId) this._retargetSpectate();
    if (this.isHost) this._checkRoundEnd();
  }

  _onPlayerLost(id) {
    // a player disconnected entirely (any phase)
    const av = this.avatars.get(id);
    if (av) {
      av.die();
      const idx = this.game.enemies.indexOf(av);
      if (idx >= 0) this.game.enemies.splice(idx, 1);
      setTimeout(() => av.dispose(), 1500);   // let the collapse anim play
      this.avatars.delete(id);
    }
    this.aliveIds.delete(id);
    if (this.phase === 'fighting') {
      this.game.hud.announce(`${this.nameOf(id) || 'A RIVAL'} FLED THE SKY`, 'sub');
      if (!this.game.player.alive && this.spectateId === id) this._retargetSpectate();
      if (this.isHost) this._checkRoundEnd();
    }
    if (this.phase === 'lobby') this.game.menus.renderLobby(this.lobbyState());
  }

  // host only: schedule the round end once <=1 player stands
  _checkRoundEnd() {
    if (!this.isHost || this.phase !== 'fighting') return;
    if (this.aliveIds.size <= 1 && this._endGraceT <= 0) {
      this._endGraceT = 0.9;   // grace so near-simultaneous deaths become a draw
    }
  }

  _declareWinner() {
    if (!this.isHost || this.phase !== 'fighting') return;
    const winner = this.aliveIds.size === 1 ? [...this.aliveIds][0] : null;
    if (winner !== null) {
      const p = this.net.player(winner);
      if (p) p.data.wins = (p.data.wins || 0) + 1;
      this.net._broadcastRoster();
    }
    this.net.send({ t: 'over', w: winner });
    this._roundOver(winner);
  }

  _roundOver(winnerId) {
    if (this.phase !== 'fighting') return;
    this.phase = 'roundover';
    this._overT = 3.4;
    const g = this.game;
    if (winnerId === null || winnerId === undefined) {
      g.hud.announce('NOBODY SURVIVED', 'sub');
    } else if (winnerId === this.net.meId) {
      g.hud.announce('YOU TAKE THE SKY', '');
      g.hud.flash('rgba(120, 220, 140, 0.14)', 0.4);
      g.audio?.play('waveClear');
    } else {
      g.hud.announce(`${this.nameOf(winnerId)} TAKES THE SKY`, '');
    }
  }

  _toLobby() {
    const g = this.game;
    this.phase = 'lobby';
    if (this.isHost) this.net.roomInfoExtra.inRound = false;
    this._disposeAvatars();
    g.projectiles.onSpawn = null;
    g.player.freeze = true;
    g.player.suppressCamera = false;
    if (g.combat) g.combat.viewmodel.group.visible = true;
    if (this._baseWalkSpeed) g.player.walkSpeed = this._baseWalkSpeed;
    g.hud.setSpectating?.(null);
    g.hud.hide();
    g.state = 'menu';          // lobby sits over the cinematic menu camera
    document.exitPointerLock?.();
    g.menus.showLobby();
    g.menus.renderLobby(this.lobbyState());
  }

  _disposeAvatars() {
    for (const [, av] of this.avatars) {
      const idx = this.game.enemies.indexOf(av);
      if (idx >= 0) this.game.enemies.splice(idx, 1);
      av.dispose();
    }
    this.avatars.clear();
  }
}
