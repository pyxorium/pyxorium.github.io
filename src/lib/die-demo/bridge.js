// The host page's relay logic, with no browser or loader dependencies, so it can be tested on its own.
//
// A tile is blocked from every network connection, so it cannot talk to the relay itself. The host page
// holds one relay connection per tile (one per seat) and passes messages both ways. This module is that
// logic. Protocol: ../../shared/die-control-protocol.md (frames, reload rules, the `hello` rule).
//
// Rules it implements:
//   * a tile's `hello` (it has just started) is answered here and NEVER forwarded to the relay;
//   * the first hello gets the current presence and lag (the tile may have missed them while loading);
//     a LATER hello means the tile was reloaded, so its seat is re-joined, which makes the relay tell the
//     other tile its partner is back, so it re-sends its state;
//   * only the four relay message kinds are forwarded; anything else from a tile is dropped, because the
//     relay closes a connection after a few bad frames;
//   * a dropped connection is retried with a growing delay, and the tile is told its partner is gone;
//   * one `ping` a few seconds apart measures the round trip that the tiles show as lag.

export const RELAY_KINDS = ['wish', 'grant', 'motion', 'scheme'];
export const ROLES = ['bob', 'alice'];

export function randomSession(cryptoImpl = globalThis.crypto) {
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createBridge(opts) {
  const {
    relayUrl,
    toTile,                                   // (role, message) => void: deliver to that tile
    WebSocketImpl = globalThis.WebSocket,
    session = randomSession(),
    pingEveryMs = 5000,
    backoffMs = [1000, 2000, 4000, 8000, 10000],
    now = () => performance.now(),
    onWire = () => {},                        // ('out'|'in', role, frame): every frame on the wire, for the log
    onEvent = () => {},                       // misc events: hello, relay-error, dropped, state changes
  } = opts;

  const seats = {};
  for (const role of ROLES) {
    seats[role] = { ws: null, gen: 0, state: 'connecting', presence: null, rtt: null,
                    helloCount: 0, attempt: 0, retryTimer: null, pingTimer: null, dropped: 0, errors: [] };
  }
  let closed = false;
  const other = (role) => (role === 'bob' ? 'alice' : 'bob');

  function setState(role, state) {
    if (seats[role].state === state) return;
    seats[role].state = state;
    onEvent({ type: 'state', role, state });
  }
  function setPresence(role, presence) {
    seats[role].presence = presence;
    toTile(role, { kind: 'presence', state: presence });
  }
  function stopPing(seat) { if (seat.pingTimer) { clearInterval(seat.pingTimer); seat.pingTimer = null; } }
  function sendFrame(role, frame) {
    const seat = seats[role];
    if (!seat.ws || seat.ws.readyState !== 1) return false;
    seat.ws.send(JSON.stringify(frame));
    onWire('out', role, frame);
    return true;
  }
  function ping(role) { sendFrame(role, { t: 'ping', n: Math.round(now()) }); }

  function connect(role) {
    if (closed) return;
    const seat = seats[role];
    seat.gen += 1;
    const gen = seat.gen;
    const old = seat.ws;
    const ws = new WebSocketImpl(relayUrl);
    seat.ws = ws;
    setState(role, 'connecting');
    if (old) { try { old.close(); } catch { /* the relay closes a replaced seat itself */ } }

    ws.onopen = () => { if (gen === seat.gen) ws.send(JSON.stringify({ t: 'join', session, role })); };
    ws.onmessage = (ev) => {
      if (gen !== seat.gen) return;            // a replaced connection: ignore
      let f; try { f = JSON.parse(ev.data); } catch { return; }
      if (!f || typeof f !== 'object') return;
      onWire('in', role, f);
      switch (f.t) {
        case 'joined':
          seat.attempt = 0; setState(role, 'live');
          setPresence(role, f.peer ? 'present' : 'gone');
          ping(role);                          // a first lag reading straight away
          stopPing(seat);
          seat.pingTimer = setInterval(() => ping(role), pingEveryMs);
          break;
        case 'peer':
          setPresence(role, f.state === 'present' ? 'present' : 'gone');
          break;
        case 'pong':
          seat.rtt = Math.max(0, Math.round(now() - f.n));
          toTile(role, { kind: 'rtt', ms: seat.rtt });
          break;
        case 'err':
          seat.errors.push(f.code); onEvent({ type: 'relay-error', role, code: f.code });
          break;
        default:
          if (RELAY_KINDS.includes(f.t)) { const { t, ...rest } = f; toTile(role, { kind: t, ...rest }); }
      }
    };
    ws.onclose = () => {
      if (gen !== seat.gen || closed) return;
      stopPing(seat);
      setState(role, 'down');
      if (seat.presence !== 'gone') setPresence(role, 'gone');     // this tile can no longer see its partner
      const delay = backoffMs[Math.min(seat.attempt, backoffMs.length - 1)];
      seat.attempt += 1;
      onEvent({ type: 'reconnect-scheduled', role, inMs: delay });
      seat.retryTimer = setTimeout(() => connect(role), delay);
    };
    ws.onerror = () => { /* a close always follows */ };
  }

  // A message from a tile (already unwrapped from the loader's channel).
  function onTileMessage(role, payload) {
    if (closed || !seats[role] || !payload || typeof payload !== 'object' || typeof payload.kind !== 'string') return;
    const seat = seats[role];
    const { kind, ...rest } = payload;
    if (kind === 'hello') {
      seat.helloCount += 1;
      onEvent({ type: 'hello', role, count: seat.helloCount });
      if (seat.helloCount === 1) {             // first start: catch the tile up on what it may have missed
        if (seat.presence !== null) toTile(role, { kind: 'presence', state: seat.presence });
        if (seat.rtt !== null) toTile(role, { kind: 'rtt', ms: seat.rtt });
      } else {                                 // reloaded: re-join the seat so the partner re-sends its state
        clearTimeout(seat.retryTimer);
        connect(role);
      }
      return;                                  // never forwarded to the relay
    }
    if (!RELAY_KINDS.includes(kind)) { seat.dropped += 1; onEvent({ type: 'dropped', role, kind }); return; }
    if (!sendFrame(role, { t: kind, ...rest })) { seat.dropped += 1; onEvent({ type: 'dropped', role, kind, reason: 'not connected' }); }
  }

  function start() { ROLES.forEach(connect); }
  function close() {
    closed = true;
    for (const role of ROLES) {
      const seat = seats[role];
      clearTimeout(seat.retryTimer); stopPing(seat);
      try { seat.ws && seat.ws.close(); } catch { /* already closed */ }
    }
  }
  function status() {
    const out = { session };
    for (const role of ROLES) {
      const s = seats[role];
      out[role] = { state: s.state, presence: s.presence, rtt: s.rtt, helloCount: s.helloCount,
                    attempt: s.attempt, dropped: s.dropped, errors: s.errors.slice() };
    }
    return out;
  }

  return { start, close, status, onTileMessage, session, other,
           _seat: (role) => seats[role] };       // for tests
}
