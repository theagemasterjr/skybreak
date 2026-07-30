// ---------------------------------------------------------------------------
// RoomNet: named multiplayer rooms over PeerJS (WebRTC), up to 4 players.
//
// Topology: STAR. The room creator claims one of ROOM_SLOTS well-known peer
// IDs and relays every message between guests. The multiplayer menu discovers
// rooms by scanning all slots with a throwaway peer and asking each host for
// its room info.
//
// Host migration: every roster broadcast carries every player's raw peer ID,
// so when the host vanishes each survivor deterministically picks the same
// successor (lowest player id) and dials it directly — no broker matchmaking
// involved. The successor keeps its existing peer, adopts the incoming
// reconnects under their OLD player ids, and re-claims the room slot in the
// background so the room stays discoverable. Gameplay barely pauses because
// clients are authoritative over their own players; the host is just a relay
// plus round referee.
// ---------------------------------------------------------------------------

export const ROOM_PREFIX = 'skybreak-room-v1-slot-';
export const ROOM_SLOTS = 8;
export const MAX_PLAYERS = 4;
const SCAN_TIMEOUT = 2500;     // ms to wait for one slot to answer
const HELLO_TIMEOUT = 6000;    // ms for a join/migrate dial to succeed
const HEARTBEAT_MS = 1500;     // host -> guests keepalive
const HOST_SILENCE = 6;        // s of host silence before we migrate
const MIGRATE_GRACE = 7000;    // ms the new host waits for stragglers

// Optional signaling-server override (?peerhost=…) — same convention as
// net.js, used by the automated multi-client test harness.
function peerOptions() {
  const q = new URLSearchParams(window.location.search);
  const host = q.get('peerhost');
  if (!host) return undefined;
  return {
    host,
    port: Number(q.get('peerport') || 443),
    path: q.get('peerpath') || '/',
    secure: q.get('peersecure') !== '0',
  };
}

function makePeer(id) {
  const opts = peerOptions();
  if (id) return opts ? new window.Peer(id, opts) : new window.Peer(id);
  return opts ? new window.Peer(opts) : new window.Peer();
}

// ---------------------------------------------------------------------------
// One-shot room list scan. Creates a temp peer, pings every slot, calls
// onDone with [{slot, name, count, max, inRound}] (answering rooms only).
// Returns a handle with cancel().
// ---------------------------------------------------------------------------
export function scanRooms(onDone) {
  const found = [];
  let cancelled = false;
  let pendingPeers = [];

  const finish = () => {
    if (cancelled) return;
    cancelled = true;
    for (const p of pendingPeers) { try { p.destroy(); } catch { /* fine */ } }
    onDone(found.sort((a, b) => a.slot - b.slot));
  };

  const peer = makePeer();
  pendingPeers.push(peer);
  let done = 0;
  const timer = setTimeout(finish, SCAN_TIMEOUT + ROOM_SLOTS * 150 + 2500);

  peer.on('error', (err) => {
    if (err.type === 'peer-unavailable') return; // per-slot, expected
    clearTimeout(timer);
    finish();
  });

  peer.on('open', () => {
    for (let i = 0; i < ROOM_SLOTS; i++) {
      const conn = peer.connect(ROOM_PREFIX + i, { reliable: true });
      let settled = false;
      const one = () => {
        if (settled) return;
        settled = true;
        try { conn.close(); } catch { /* fine */ }
        if (++done >= ROOM_SLOTS) { clearTimeout(timer); finish(); }
      };
      setTimeout(one, SCAN_TIMEOUT);
      conn.on('open', () => conn.send({ t: 'info?' }));
      conn.on('data', (data) => {
        const m = typeof data === 'string' ? JSON.parse(data) : data;
        if (m && m.t === 'info') {
          found.push({ slot: i, name: m.name, count: m.count, max: m.max, inRound: !!m.inRound });
        }
        one();
      });
      conn.on('error', one);
    }
  });

  return { cancel: finish };
}

// ---------------------------------------------------------------------------
// RoomNet proper
// ---------------------------------------------------------------------------
export class RoomNet {
  constructor() {
    this.peer = null;          // my identity peer (host's = the slot peer at creation)
    this.slotPeer = null;      // migrated host only: extra peer holding the slot
    this.slot = -1;
    this.roomName = '';
    this.meId = -1;
    this.hostId = -1;
    this.nextId = 1;           // host: next player id to assign
    this.roster = [];          // [{id, peerId, data}]  data = app payload (name, cls, wins…)
    this.conns = new Map();    // host: playerId -> conn ; guest: hostId -> conn
    this.state = 'idle';       // idle | joining | live | migrating | dead
    this.roomInfoExtra = {};   // host: app-set fields merged into scan answers (inRound)
    this._timers = [];
    this._hostAge = 0;
    this._sendQueue = [];      // messages queued while migrating

    // ---- app callbacks ----
    this.onStatus = null;      // (text)
    this.onRoster = null;      // () — roster/hostId/meId changed, re-render
    this.onMessage = null;     // (fromId, msg)
    this.onPlayerLost = null;  // (id) — a player dropped (host relays this too)
    this.onMigrating = null;   // () — host lost, hold tight
    this.onMigrated = null;    // () — new host live (may be me)
    this.onClosed = null;      // (reason) — room is gone for good
  }

  get isHost() { return this.meId === this.hostId; }
  get live() { return this.state === 'live' || this.state === 'migrating'; }
  me() { return this.roster.find((p) => p.id === this.meId); }
  player(id) { return this.roster.find((p) => p.id === id); }

  // ---------------- creation ----------------
  createRoom(roomName, myData) {
    this.roomName = String(roomName).slice(0, 24);
    this.state = 'joining';
    this._status('OPENING ROOM');
    this._tryClaimSlot(0, myData);
  }

  _tryClaimSlot(slot, myData) {
    if (this.state !== 'joining') return;
    if (slot >= ROOM_SLOTS) {
      this.state = 'dead';
      if (this.onClosed) this.onClosed('THE SKY IS FULL — ALL ROOM SLOTS TAKEN');
      return;
    }
    this._destroyPeer();
    const peer = makePeer(ROOM_PREFIX + slot);
    this.peer = peer;
    peer.on('open', () => {
      this.slot = slot;
      this.meId = 0;
      this.hostId = 0;
      this.nextId = 1;
      this.roster = [{ id: 0, peerId: peer.id, data: myData }];
      this.state = 'live';
      this._wireHostPeer(peer);
      this._startHeartbeat();
      this._status('ROOM OPEN');
      if (this.onRoster) this.onRoster();
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') this._tryClaimSlot(slot + 1, myData);
      else if (err.type !== 'peer-unavailable' && this.state === 'joining') {
        this.state = 'dead';
        if (this.onClosed) this.onClosed('SIGNAL LOST');
      }
    });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  }

  // host: accept joins, info queries, migrations on a listening peer
  _wireHostPeer(peer) {
    if (peer._skyWired) return;   // never double-wire (repeat migrations)
    peer._skyWired = true;
    peer.on('connection', (conn) => {
      conn.on('open', () => { /* wait for their first message to classify */ });
      conn.on('data', (data) => {
        let m;
        try { m = typeof data === 'string' ? JSON.parse(data) : data; } catch { return; }
        if (!m || this.state === 'dead') return;

        if (m.t === 'info?') {
          conn.send({
            t: 'info', name: this.roomName,
            count: this.roster.length, max: MAX_PLAYERS,
            ...this.roomInfoExtra,
          });
          return;
        }
        if (m.t === 'hello') {                       // fresh join
          if (!this.isHost) { conn.send({ t: 'nothost' }); return; }
          if (this.roster.length >= MAX_PLAYERS) { conn.send({ t: 'full' }); conn.close(); return; }
          const id = this.nextId++;
          this.roster.push({ id, peerId: conn.peer, data: m.data || {} });
          this._adoptGuest(id, conn);
          conn.send({
            t: 'welcome', yourId: id, roomName: this.roomName,
            roster: this.roster, hostId: this.hostId, slot: this.slot,
          });
          this._broadcastRoster();
          if (this.onRoster) this.onRoster();
          return;
        }
        if (m.t === 'hello2') {                      // migration reconnect
          if (!this.isHost) { conn.send({ t: 'nothost' }); return; }
          const existing = this.player(m.myId);
          if (existing) existing.peerId = conn.peer;
          else this.roster.push({ id: m.myId, peerId: conn.peer, data: m.data || {} });
          this._adoptGuest(m.myId, conn);
          conn.send({
            t: 'welcome', yourId: m.myId, roomName: this.roomName,
            roster: this.roster, hostId: this.hostId, slot: this.slot, migrated: true,
          });
          this._broadcastRoster();
          if (this.onRoster) this.onRoster();
          // a survivor just re-dialed: deliver anything held back for them
          if (this._sendQueue.length) this._flushQueue();
          return;
        }
        // anything else on a not-yet-adopted conn: ignore
      });
    });
  }

  _adoptGuest(id, conn) {
    const old = this.conns.get(id);
    if (old && old !== conn) { try { old.close(); } catch { /* fine */ } }
    this.conns.set(id, conn);
    conn.on('data', (data) => this._onGuestData(id, data));
    conn.on('close', () => this._onGuestGone(id, conn));
    conn.on('error', () => this._onGuestGone(id, conn));
  }

  _onGuestData(fromId, data) {
    let m;
    try { m = typeof data === 'string' ? JSON.parse(data) : data; } catch { return; }
    if (!m) return;
    switch (m.t) {
      case 'm':     // broadcast request: relay to everyone else + deliver locally
        this._relay(fromId, m.m, null);
        if (this.onMessage) this.onMessage(fromId, m.m);
        break;
      case 'mt':    // targeted
        if (m.to === this.meId) {
          if (this.onMessage) this.onMessage(fromId, m.m);
        } else {
          this._relay(fromId, m.m, m.to);
        }
        break;
      case 'data': {  // roster payload update (class pick, name…)
        const p = this.player(fromId);
        if (p) { Object.assign(p.data, m.d); this._broadcastRoster(); if (this.onRoster) this.onRoster(); }
        break;
      }
      case 'bye':
        this._dropPlayer(fromId, true);
        break;
    }
  }

  _onGuestGone(id, conn) {
    if (this.conns.get(id) !== conn) return;   // superseded (migration re-adopt)
    this._dropPlayer(id, true);
  }

  // host: remove a player and tell the world
  _dropPlayer(id, announce) {
    if (!this.isHost || this.state === 'dead') return;
    const idx = this.roster.findIndex((p) => p.id === id);
    if (idx < 0) return;
    this.roster.splice(idx, 1);
    const conn = this.conns.get(id);
    if (conn) { try { conn.close(); } catch { /* fine */ } this.conns.delete(id); }
    // stop holding queued messages for someone who is never coming back
    this._sendQueue = this._sendQueue.filter((i) => !(i.kind === 't' && i.id === id));
    if (announce) {
      this._broadcastRoster();
      if (this.onPlayerLost) this.onPlayerLost(id);
      if (this.onRoster) this.onRoster();
    }
  }

  _relay(fromId, msg, toId) {
    const env = { t: 'r', f: fromId, m: msg };
    if (toId !== null && toId !== undefined) {
      const conn = this.conns.get(toId);
      if (conn && conn.open) conn.send(env);
      return;
    }
    for (const [id, conn] of this.conns) {
      if (id === fromId) continue;
      if (conn.open) conn.send(env);
    }
  }

  _broadcastRoster() {
    const msg = { t: 'roster', roster: this.roster, hostId: this.hostId, slot: this.slot };
    for (const [, conn] of this.conns) { if (conn.open) conn.send(msg); }
  }

  _startHeartbeat() {
    const timer = setInterval(() => {
      if (this.state === 'dead') { clearInterval(timer); return; }
      if (!this.isHost) return;
      for (const [, conn] of this.conns) { if (conn.open) conn.send({ t: 'hb' }); }
    }, HEARTBEAT_MS);
    this._timers.push(timer);
  }

  // ---------------- joining ----------------
  joinRoom(slot, myData) {
    this.state = 'joining';
    this._status('JOINING ROOM');
    this._destroyPeer();
    const peer = makePeer();
    this.peer = peer;
    this._myData = myData;
    peer.on('open', () => this._dialHost(ROOM_PREFIX + slot, { t: 'hello', data: myData }));
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable' && this.state === 'joining') {
        this.state = 'dead';
        if (this.onClosed) this.onClosed('ROOM IS GONE');
      }
    });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  }

  _dialHost(peerId, helloMsg, onFail) {
    const conn = this.peer.connect(peerId, { reliable: true });
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      try { conn.close(); } catch { /* fine */ }
      if (onFail) onFail();
      else if (this.state === 'joining') {
        this.state = 'dead';
        if (this.onClosed) this.onClosed('COULD NOT REACH THE ROOM');
      }
    };
    const timer = setTimeout(fail, HELLO_TIMEOUT);
    this._timers.push(timer);
    conn.on('open', () => conn.send(helloMsg));
    conn.on('error', fail);
    conn.on('close', () => { if (!settled) fail(); });
    conn.on('data', (data) => {
      let m;
      try { m = typeof data === 'string' ? JSON.parse(data) : data; } catch { return; }
      if (!m) return;
      if (m.t === 'welcome') {
        settled = true;
        clearTimeout(timer);
        this._becomeGuest(conn, m);
        return;
      }
      if (m.t === 'full') { settled = true; clearTimeout(timer); this.state = 'dead'; if (this.onClosed) this.onClosed('ROOM IS FULL'); return; }
      if (m.t === 'nothost') { fail(); return; }
      // post-welcome traffic is handled in _becomeGuest's listener
    });
  }

  _becomeGuest(conn, welcome) {
    this.meId = welcome.yourId;
    this.hostId = welcome.hostId;
    this.roomName = welcome.roomName;
    this.roster = welcome.roster;
    if (welcome.slot >= 0) this.slot = welcome.slot;   // needed if I ever inherit hosting
    this.conns.clear();
    this.conns.set(this.hostId, conn);
    this._hostAge = 0;
    const wasMigrating = this.state === 'migrating';
    this.state = 'live';
    conn.on('data', (data) => this._onHostData(conn, data));
    conn.on('close', () => this._onHostGone(conn));
    conn.on('error', () => this._onHostGone(conn));
    this._status('CONNECTED');
    if (this.onRoster) this.onRoster();
    if (wasMigrating) {
      if (this.onMigrated) this.onMigrated();
      this._flushQueue();
    }
  }

  _onHostData(conn, data) {
    if (this.conns.get(this.hostId) !== conn) return;
    this._hostAge = 0;
    let m;
    try { m = typeof data === 'string' ? JSON.parse(data) : data; } catch { return; }
    if (!m) return;
    switch (m.t) {
      case 'hb': break;
      case 'roster': {
        const oldIds = new Set(this.roster.map((p) => p.id));
        this.roster = m.roster;
        this.hostId = m.hostId;
        if (m.slot >= 0) this.slot = m.slot;
        for (const was of oldIds) {
          if (!this.roster.some((p) => p.id === was) && this.onPlayerLost) this.onPlayerLost(was);
        }
        if (this.onRoster) this.onRoster();
        break;
      }
      case 'r':
        if (this.onMessage) this.onMessage(m.f, m.m);
        break;
      case 'welcome': break;   // duplicate, ignore
      case 'closed':
        this._die('THE HOST CLOSED THE ROOM');
        break;
    }
  }

  // ---------------- host migration ----------------
  _onHostGone(conn) {
    if (this.conns.get(this.hostId) !== conn) return;  // superseded
    if (this.state !== 'live') return;
    this._migrate();
  }

  _migrate() {
    if (this.state !== 'live' || this.isHost) return;
    this.state = 'migrating';
    if (this.onMigrating) this.onMigrating();
    this._status('HOST LOST — RECONNECTING');
    // drop the dead host from our local roster copy, pick the successor
    const oldHost = this.hostId;
    const survivors = this.roster.filter((p) => p.id !== oldHost);
    if (!survivors.length) { this._die('EVERYONE LEFT'); return; }
    const order = survivors.map((p) => p.id).sort((a, b) => a - b);
    this._migrateTo(survivors, order, 0);
  }

  _migrateTo(survivors, order, k) {
    if (this.state !== 'migrating') return;
    if (k >= order.length) { this._die('THE ROOM FELL APART'); return; }
    const succId = order[k];

    if (succId === this.meId) {
      // I am the new host: adopt survivors as they dial in
      this.hostId = this.meId;
      this.roster = survivors;
      this.nextId = Math.max(...order) + 1;
      this.conns.clear();
      this._wireHostPeer(this.peer);      // idempotent-ish: peer may already have the handler from a past migration; guard below
      this.state = 'live';
      this._reclaimSlot();
      this._broadcastRoster();
      if (this.onRoster) this.onRoster();
      if (this.onMigrated) this.onMigrated();
      this._flushQueue();
      // stragglers who never dial in get dropped after the grace window
      const timer = setTimeout(() => {
        if (this.state === 'dead' || !this.isHost) return;
        let changed = false;
        for (const p of [...this.roster]) {
          if (p.id === this.meId) continue;
          if (!this.conns.has(p.id)) {
            this.roster = this.roster.filter((q) => q.id !== p.id);
            if (this.onPlayerLost) this.onPlayerLost(p.id);
            changed = true;
          }
        }
        if (changed) { this._broadcastRoster(); if (this.onRoster) this.onRoster(); }
      }, MIGRATE_GRACE);
      this._timers.push(timer);
      return;
    }

    // dial the successor's known raw peer id
    const succ = survivors.find((p) => p.id === succId);
    const me = survivors.find((p) => p.id === this.meId);
    this._dialHost(
      succ.peerId,
      { t: 'hello2', myId: this.meId, data: me ? me.data : {} },
      () => this._migrateTo(survivors, order, k + 1)   // next candidate
    );
  }

  // migrated host: grab the room slot again (broker frees it once the old
  // host's socket dies) so the room stays in the menu scan. The slot number
  // rides on every welcome/roster broadcast, so any successor knows it.
  _reclaimSlot() {
    let tries = 0;
    const attempt = () => {
      if (this.state === 'dead' || !this.isHost || this.slotPeer) return;
      if (this.slot < 0 || tries++ > 10) return;
      const sp = makePeer(ROOM_PREFIX + this.slot);
      sp.on('open', () => {
        if (this.state === 'dead' || !this.isHost) { try { sp.destroy(); } catch { /* fine */ } return; }
        this.slotPeer = sp;
        this._wireHostPeer(sp);          // joins + scans arrive here too
      });
      sp.on('error', (err) => {
        try { sp.destroy(); } catch { /* fine */ }
        if (err.type === 'unavailable-id') {
          const timer = setTimeout(attempt, 3000);
          this._timers.push(timer);
        }
      });
    };
    attempt();
  }

  // ---------------- sending ----------------
  send(msg) {                    // broadcast to everyone else
    if (this.state === 'migrating') { this._queue({ kind: 'b', msg }); return; }
    if (this.state !== 'live') return;
    if (this.isHost) {
      this._relay(this.meId, msg, null);
    } else {
      const conn = this.conns.get(this.hostId);
      if (conn && conn.open) conn.send({ t: 'm', m: msg });
    }
  }

  sendTo(id, msg) {              // targeted
    if (id === this.meId) return;
    if (this.state === 'migrating') { this._queue({ kind: 't', id, msg }); return; }
    if (this.state !== 'live') return;
    if (this.isHost) {
      this._relay(this.meId, msg, id);
    } else {
      const conn = this.conns.get(this.hostId);
      if (conn && conn.open) conn.send({ t: 'mt', to: id, m: msg });
    }
  }

  updateMyData(patch) {
    const me = this.me();
    if (me) Object.assign(me.data, patch);
    if (this.isHost) {
      this._broadcastRoster();
      if (this.onRoster) this.onRoster();
    } else if (this.state === 'live') {
      const conn = this.conns.get(this.hostId);
      if (conn && conn.open) conn.send({ t: 'data', d: patch });
    } else if (this.state === 'migrating') {
      this._queue({ kind: 'd', patch });
    }
  }

  _queue(item) {
    if (this._sendQueue.length > 400) this._sendQueue.shift();  // drop oldest (snapshots are disposable)
    this._sendQueue.push(item);
  }

  _flushQueue() {
    const q = this._sendQueue;
    this._sendQueue = [];
    const expectingPeers = this.isHost && this.roster.length > 1;
    for (const item of q) {
      // freshly promoted host: survivors re-dial asynchronously, so hold any
      // message whose recipient hasn't reconnected yet instead of dropping it
      if (item.kind === 't' && this.isHost && !this.conns.has(item.id)
          && this.roster.some((p) => p.id === item.id)) {
        this._sendQueue.push(item);
        continue;
      }
      if (item.kind === 'b' && expectingPeers && this.conns.size === 0) {
        this._sendQueue.push(item);
        continue;
      }
      if (item.kind === 'b') this.send(item.msg);
      else if (item.kind === 't') this.sendTo(item.id, item.msg);
      else if (item.kind === 'd') this.updateMyData(item.patch);
    }
  }

  // call every frame from the game loop: watches host silence
  update(dt) {
    if (this.state !== 'live' || this.isHost) return;
    this._hostAge += dt;
    if (this._hostAge > HOST_SILENCE) {
      this._hostAge = 0;
      const conn = this.conns.get(this.hostId);
      try { conn?.close(); } catch { /* fine */ }
      this._migrate();
    }
  }

  // ---------------- teardown ----------------
  leave() {
    // a leaving host says nothing: guests notice the closed connections and
    // migrate to a successor, so the room survives its own creator
    if (!this.isHost) {
      const conn = this.conns.get(this.hostId);
      if (conn && conn.open) { try { conn.send({ t: 'bye' }); } catch { /* fine */ } }
    }
    this._die(null);
  }

  _die(reason) {
    if (this.state === 'dead') return;
    this.state = 'dead';
    for (const t of this._timers) { clearTimeout(t); clearInterval(t); }
    this._timers.length = 0;
    for (const [, conn] of this.conns) { try { conn.close(); } catch { /* fine */ } }
    this.conns.clear();
    this._destroyPeer();
    if (this.slotPeer) { try { this.slotPeer.destroy(); } catch { /* fine */ } this.slotPeer = null; }
    if (reason && this.onClosed) this.onClosed(reason);
  }

  _destroyPeer() {
    if (this.peer) { try { this.peer.destroy(); } catch { /* fine */ } this.peer = null; }
  }

  _status(text) {
    if (this.onStatus) this.onStatus(text);
  }
}
