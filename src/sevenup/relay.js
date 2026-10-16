// COPY of sevenup-tiles/harness/relay.js (tested there: npm test). Edit it there, then run
// node scripts/copy-to-site.mjs <site folder> to bring it here.

// relay.js: the page's side of a Seven-Up table, with no browser dependencies so it can be tested in
// Node. The stand-in page uses it now; the real hidden page (step 2) will use the same file.
//
// The page knows which frame a message came from (event.source), so it stamps every payload with its
// sender: "seat1", "seat2" or "house". Whatever `from` a tile writes itself is overwritten.
// Players talk only to the house; the house addresses players with `to`.

export const GAME = 'sevenup';
export const VERSION = 1;
export const SENDERS = ['seat1', 'seat2', 'house'];

// What each sender may say, and to whom it goes.
export const PLAYER_TO_HOUSE = ['wish', 'grant', 'confirmation', 'roll', 'rematch'];
export const PLAYER_TO_PAGE = ['hello', 'pong', 'sprite-request', 'save-request', 'show-table'];
export const HOUSE_TO_PLAYERS = ['view', 'picture', 'grant', 'wish', 'flip', 'turn', 'rolled', 'round-over', 'match-over', 'rematch', 'paused', 'resumed'];
export const HOUSE_TO_PAGE = ['hello', 'pong', 'state', 'result'];
export const PAGE_TO_HOUSE = ['ping', 'seated', 'presence', 'resume', 'sync'];
export const PAGE_TO_PLAYER = ['ping', 'seat', 'sprite', 'sprite-status', 'save-status', 'presence'];
// The heartbeat (ping / pong every few seconds) isn't worth a line in a message log.
export const QUIET_KINDS = ['ping', 'pong'];

export const LIMITS = {
  maxBytes: 64 * 1024,          // per message, pictures included (a 320 px table picture is about 4 KB)
  burst: 40,                    // messages a sender may send at once…
  perSecond: 20,                // …refilled at this rate; more are dropped
};

// Rough size of a payload: its JSON, plus the bytes of any Blob or ArrayBuffer field.
export function sizeOf(payload) {
  let extra = 0;
  const json = JSON.stringify(payload, (k, v) => {
    if (v && typeof v === 'object') {
      if (typeof v.size === 'number' && typeof v.type === 'string' && typeof v.arrayBuffer === 'function') { extra += v.size; return '[blob]'; }
      if (v instanceof ArrayBuffer) { extra += v.byteLength; return '[bytes]'; }
    }
    return v;
  });
  return (json ? json.length : 0) + extra;
}

export function createRelay({ deliver, onPage = () => {}, onLog = () => {}, now = () => Date.now(), limits = LIMITS }) {
  // deliver(target, payload): target is "seat1" | "seat2" | "house"
  // onPage(from, payload): a message meant for the page itself
  const buckets = Object.fromEntries(SENDERS.map((s) => [s, { tokens: limits.burst, at: now() }]));

  function allowed(sender) {
    const b = buckets[sender];
    const t = now();
    b.tokens = Math.min(limits.burst, b.tokens + ((t - b.at) / 1000) * limits.perSecond);
    b.at = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  function drop(sender, payload, why) {
    onLog({ dir: 'drop', from: sender, kind: payload && payload.kind, why });
    return why;
  }

  // A payload arrived from one of the three frames. Returns null when passed on, or why it was dropped.
  function fromTile(sender, raw) {
    if (!SENDERS.includes(sender)) return drop(sender, raw, 'unknown frame');
    if (!raw || typeof raw !== 'object' || raw.game !== GAME || raw.v !== VERSION || typeof raw.kind !== 'string') return drop(sender, raw, 'not a Seven-Up message');
    if (sizeOf(raw) > limits.maxBytes) return drop(sender, raw, 'too big');
    if (!allowed(sender)) return drop(sender, raw, 'too many');
    const payload = { ...raw, from: sender };       // the page's stamp replaces any `from` the tile wrote

    if (sender === 'house') {
      const to = payload.to;
      if (to === 'page') {
        if (!HOUSE_TO_PAGE.includes(payload.kind)) return drop(sender, raw, 'house may not send that to the page');
        onLog({ dir: 'page', from: sender, kind: payload.kind });
        onPage(sender, payload);
        return null;
      }
      if (!HOUSE_TO_PLAYERS.includes(payload.kind)) return drop(sender, raw, 'house may not send that to players');
      const targets = to === 'players' ? ['seat1', 'seat2'] : to === 'seat1' || to === 'seat2' ? [to] : null;
      if (!targets) return drop(sender, raw, 'no such recipient');
      for (const t of targets) deliver(t, payload);
      onLog({ dir: 'relay', from: sender, to: targets.join('+'), kind: payload.kind, bytes: sizeOf(raw) });
      return null;
    }

    // A player: only to the house, or to the page.
    if (PLAYER_TO_PAGE.includes(payload.kind)) {
      onLog({ dir: 'page', from: sender, kind: payload.kind });
      onPage(sender, payload);
      return null;
    }
    if (!PLAYER_TO_HOUSE.includes(payload.kind)) return drop(sender, raw, 'players may not send that');
    delete payload.to;
    deliver('house', payload);
    onLog({ dir: 'relay', from: sender, to: 'house', kind: payload.kind, bytes: sizeOf(raw) });
    return null;
  }

  // The page's own messages, checked the same way so a typo can't slip through.
  function fromPage(target, kind, fields = {}) {
    const ok = target === 'house' ? PAGE_TO_HOUSE.includes(kind) : (target === 'seat1' || target === 'seat2') && PAGE_TO_PLAYER.includes(kind);
    if (!ok) throw new Error(`page may not send ${kind} to ${target}`);
    const payload = { ...fields, game: GAME, v: VERSION, kind, from: 'page' };
    deliver(target, payload);
    onLog({ dir: 'relay', from: 'page', to: target, kind });
  }

  return { fromTile, fromPage };
}
