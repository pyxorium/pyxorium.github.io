// frames.js: the three tile frames (four against the bot: its own house) of one seat at a Daisy table (its house, your player tile, and the copy
// watching the other seat) and their health. Copied from src/sevenup/frames.js (roles renamed).
//
// One shared tile loader ("mothership") for the page: each one listens to every message on the page,
// so several would trip over each other's tiles. Each tile can be started afresh (a new frame, a new
// random name on the loading server, a new worker), which is what Try again does.
//
// Health, per tile:
//   loading  → "Loading…"; after 4 s "Still loading…"; after 8 s a Try again ("stuck")
//   ready    → the tile has said something (its hello)
//   stopped  → it missed two heartbeats in a row; it becomes ready again if it speaks up
//   failed   → the loader couldn't load it at all
// The page sends the heartbeat itself (ping); any message from a tile counts as an answer.

export const ROLES = ['house', 'mine', 'theirs', 'bot'];   // bot: the bot's house (step 7), only against the bot
const DOWN = 'tiles-protocol-down-data-payload';

export function createFrames({ makeMothership, tileUrlFor, mounts, heights, times, onStatus = () => {}, ping = () => {} }) {
  let mothership = null;
  const ship = () => (mothership ||= makeMothership());
  const state = Object.fromEntries(ROLES.map((r) => [r, { frame: null, status: 'idle', attempt: 0, timers: [], lastSeen: 0 }]));

  function set(role, status, extra = {}) {
    const s = state[role];
    if (s.status === status && !extra.force) return;
    s.status = status;
    onStatus(role, status, extra);
  }

  async function start(role) {
    const s = state[role];
    const mine = ++s.attempt;
    s.timers.forEach(clearTimeout);
    if (s.frame) { s.frame.remove(); s.frame = null; }
    set(role, 'loading', { force: true });
    s.timers = [
      setTimeout(() => { if (mine === s.attempt && s.status === 'loading') set(role, 'slow'); }, times.still),
      setTimeout(() => { if (mine === s.attempt && (s.status === 'loading' || s.status === 'slow')) set(role, 'stuck'); }, times.retry),
    ];
    let tile = null;
    try { tile = await ship().loadTile(tileUrlFor(role)); } catch (err) { console.error('[daisy] tile load failed', role, err); }
    if (mine !== s.attempt) return;
    if (!tile) { s.timers.forEach(clearTimeout); set(role, 'failed'); return; }
    s.frame = tile.renderContent(heights[role]);
    s.frame.title = role === 'house' ? 'The house (referee)' : role === 'bot' ? "The bot's house" : role === 'mine' ? 'Your seat' : 'The other seat';
    mounts[role].appendChild(s.frame);
  }

  // Which role sent a message (by the frame it came from), or null.
  function roleOf(source) {
    for (const r of ROLES) if (state[r].frame && state[r].frame.contentWindow === source) return r;
    return null;
  }

  // Any message from a tile: it's alive.
  function heard(role) {
    const s = state[role];
    s.lastSeen = performance.now();
    if (s.status === 'loading' || s.status === 'slow' || s.status === 'stuck') {
      s.timers.forEach(clearTimeout);
      set(role, 'ready', { first: true });
    } else if (s.status === 'stopped') {
      set(role, 'ready', { recovered: true });
    }
  }

  function send(role, payload) {
    const w = state[role].frame && state[role].frame.contentWindow;
    if (w) w.postMessage({ action: DOWN, payload }, '*');
  }

  // The heartbeat. Skipped while the page is in the background (browsers slow its timers then).
  let n = 0;
  const limit = () => times.heartbeat * times.misses + 1000;
  const beat = setInterval(() => {
    if (document.hidden) return;
    n++;
    const now = performance.now();
    for (const r of ROLES) {
      const s = state[r];
      if (s.status !== 'ready' && s.status !== 'stopped') continue;
      if (s.status === 'ready' && now - s.lastSeen > limit()) set(r, 'stopped');
      ping(r, n);
    }
  }, times.heartbeat);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) for (const r of ROLES) state[r].lastSeen = performance.now();
  });

  return {
    start, roleOf, heard, send,
    status: (role) => state[role].status,
    stop() { clearInterval(beat); },
  };
}
