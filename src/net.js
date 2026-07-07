// ---------------------------------------------------------------------------
// DuelNet: peer-to-peer matchmaking + messaging over PeerJS (WebRTC).
// No game server needed — the free PeerJS cloud broker only introduces the
// two browsers, then all traffic flows directly between them.
//
// Matchmaking: a handful of well-known "lobby slot" peer IDs. A searching
// player first scans the slots as a guest; if nobody is hosting, they claim
// the first free slot and host. Hosts in higher slots periodically scan the
// slots below them and yield (connect as guest) if they find someone, so two
// simultaneous searchers always converge. Plenty for a few concurrent players.
// ---------------------------------------------------------------------------

const SLOT_PREFIX = 'skybreak-duel-v1-slot-';
const SLOT_COUNT = 4;
const SCAN_TIMEOUT = 3000;   // ms to wait for one slot to answer
const HOST_RESCAN = 6000;    // ms between a host's scans of lower slots

// Optional signaling-server override (?peerhost=…&peerport=…&peerpath=…) —
// used by automated tests against a local peerjs server; defaults to the
// free PeerJS cloud when absent.
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

export class DuelNet {
  constructor() {
    this.peer = null;
    this.opts = peerOptions();
    this.conn = null;
    this.role = null;          // 'host' | 'guest'
    this.searching = false;
    this.matched = false;
    this.hostSlot = -1;

    // callbacks the duel manager wires up
    this.onStatus = null;      // (text) -> matchmaking UI updates
    this.onMatched = null;     // (role) -> both peers connected
    this.onMessage = null;     // (msg)  -> parsed message object
    this.onDisconnect = null;  // ()     -> peer gone mid-match
    this._timers = [];
  }

  get available() {
    return typeof window !== 'undefined' && !!window.Peer;
  }

  findMatch() {
    if (this.searching) return;
    this.searching = true;
    this.matched = false;
    this._status('CONNECTING');
    this._openScanner();
  }

  // if the broker connection stalls silently (flaky network, throttled tab),
  // tear the peer down and start over instead of hanging forever
  _watchdog(peer, retry) {
    const timer = setTimeout(() => {
      if (this.matched || !this.searching || peer !== this.peer || peer.open) return;
      try { peer.destroy(); } catch { /* fine */ }
      retry();
    }, 8000);
    this._timers.push(timer);
  }

  // ---- phase 1: scan the lobby slots as a guest ----
  _openScanner() {
    if (!this.searching) return;
    this._destroyPeer();
    const peer = this.opts ? new window.Peer(this.opts) : new window.Peer(); // random id
    this.peer = peer;
    this._watchdog(peer, () => this._openScanner());
    peer.on('open', () => this._scanSlot(0));
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') return; // handled per-slot
      this._retrySoon('SIGNAL LOST — RETRYING');
    });
    peer.on('disconnected', () => {
      if (!this.matched && !peer.destroyed) peer.reconnect();
    });
  }

  _scanSlot(i, maxSlot = SLOT_COUNT) {
    if (!this.searching || this.matched) return;
    if (i >= maxSlot) { this._becomeHost(0); return; }
    this._status('SEARCHING FOR OPPONENT');
    const conn = this.peer.connect(SLOT_PREFIX + i, { reliable: true });
    let settled = false;
    const next = () => {
      if (settled || this.matched) return;
      settled = true;
      this._scanSlot(i + 1, maxSlot);
    };
    const timer = setTimeout(next, SCAN_TIMEOUT);
    this._timers.push(timer);
    conn.on('open', () => {
      if (settled || this.matched) { conn.close(); return; }
      settled = true;
      clearTimeout(timer);
      this._adopt(conn, 'guest');
    });
    conn.on('error', () => { clearTimeout(timer); next(); });
    this.peer.on('error', function onErr(err) {
      if (err.type === 'peer-unavailable' && String(err).includes(SLOT_PREFIX + i)) {
        clearTimeout(timer);
        next();
      }
    });
  }

  // ---- phase 2: nobody hosting — claim a slot and wait ----
  _becomeHost(slot) {
    if (!this.searching || this.matched) return;
    if (slot >= SLOT_COUNT) { this._retrySoon('LOBBIES FULL — RETRYING'); return; }
    this._destroyPeer();
    const peer = this.opts
      ? new window.Peer(SLOT_PREFIX + slot, this.opts)
      : new window.Peer(SLOT_PREFIX + slot);
    this.peer = peer;
    this._watchdog(peer, () => this._openScanner());
    peer.on('open', () => {
      this.hostSlot = slot;
      this._status('WAITING FOR AN OPPONENT');
      // hosts above slot 0 periodically yield to hosts below them
      if (slot > 0) this._hostRescan(slot);
    });
    peer.on('connection', (conn) => {
      if (this.matched) { conn.on('open', () => conn.close()); return; }
      conn.on('open', () => {
        if (this.matched) { conn.close(); return; }
        this._adopt(conn, 'host');
      });
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') this._becomeHost(slot + 1);
      else if (err.type !== 'peer-unavailable' && !this.matched) {
        this._retrySoon('SIGNAL LOST — RETRYING');
      }
    });
    peer.on('disconnected', () => {
      if (!this.matched && !peer.destroyed) peer.reconnect();
    });
  }

  _hostRescan(mySlot) {
    let pending = [];
    const timer = setInterval(() => {
      if (this.matched || !this.searching) { clearInterval(timer); return; }
      // drop the previous round's attempts that never opened
      for (const c of pending) { if (!c.open) try { c.close(); } catch { /* fine */ } }
      pending = [];
      for (let i = 0; i < mySlot; i++) {
        const conn = this.peer.connect(SLOT_PREFIX + i, { reliable: true });
        pending.push(conn);
        conn.on('open', () => {
          if (this.matched) { conn.close(); return; }
          this._adopt(conn, 'guest');
        });
      }
    }, HOST_RESCAN);
    this._timers.push(timer);
  }

  // ---- a live connection: lock it in ----
  _adopt(conn, role) {
    this.matched = true;
    this.searching = false;
    this.conn = conn;
    this.role = role;
    this._clearTimers();
    conn.on('data', (data) => {
      if (this.onMessage) {
        try {
          const msg = typeof data === 'string' ? JSON.parse(data) : data;
          this.onMessage(msg);
        } catch { /* ignore malformed */ }
      }
    });
    conn.on('close', () => this._dropped());
    conn.on('error', () => this._dropped());
    this._status('OPPONENT FOUND');
    if (this.onMatched) this.onMatched(role);
  }

  _dropped() {
    if (!this.matched) return;
    this.matched = false;
    if (this.onDisconnect) this.onDisconnect();
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  _status(text) {
    if (this.onStatus) this.onStatus(text);
  }

  _retrySoon(text) {
    if (!this.searching) return;
    this._status(text);
    const timer = setTimeout(() => { if (this.searching) this._openScanner(); }, 2500);
    this._timers.push(timer);
  }

  _clearTimers() {
    for (const t of this._timers) { clearTimeout(t); clearInterval(t); }
    this._timers.length = 0;
  }

  _destroyPeer() {
    if (this.peer) {
      try { this.peer.destroy(); } catch { /* already gone */ }
      this.peer = null;
    }
  }

  // stop searching / leave the match
  destroy() {
    this.searching = false;
    this.matched = false;
    this._clearTimers();
    if (this.conn) { try { this.conn.close(); } catch { /* fine */ } this.conn = null; }
    this._destroyPeer();
    this.role = null;
  }
}
