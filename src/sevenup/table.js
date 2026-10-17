// table.js: the Seven-Up table page. Loads three tiles (two players and the hidden house) through the
// tile loader, passes their messages along (relay.js stamps each with its sender), seats players
// (each signs in at the seat; any atproto account) or the bot, hands out sprites, watches the
// tiles' health, keeps the house's latest snapshot for resuming after a reload, saves finished
// matches when a player asks (the page's own prompt, outside the tiles), and logs every message.
//
// mountTable(root, deps): deps carries the loader classes and the sign-in, so this file has no
// package imports and the browser checks can run it with stand-ins.
import { MARKUP } from './markup.js';
import { createRelay, QUIET_KINDS } from './relay.js';
import { recordFor, otherPlayer, checkRecord } from './record.js';
import { createFrames } from './frames.js';
import { SignInNeeded, rememberedAccounts } from './auth.js';
import { createPinnedLoader } from './pinned-loader.js';
import { cleanHandle, looksLikeHandle, fetchSprite, pdsOf, resolveHandle } from './identity.js';
import { attachTypeahead } from './typeahead.js';
import { TILES } from './tiles.generated.js';
import {
  TILE_LOAD_DOMAIN, PUBLISHED, tileSource, MEMORY_IDS, BOT, TIMES, RESUME_KEY, HOUSE_ADDRESS,
  COLLECTION, recordLink, loadSourceOverride,
} from './config.js';

const UP = 'tiles-protocol-up-data-payload';
const STATUS_TEXT = {
  loading: 'Loading the tile…', slow: 'Still loading…', stuck: 'Still loading…',
  failed: "This tile couldn't be loaded.", stopped: 'This tile stopped answering.',
};
const CHANGED_TEXT = 'This tile has changed since the table was set up, so the table won\'t use it.';

export function mountTable(root, { TileMothership, MemoryTileLoader, Tile, auth, authProblem = null, fetchImpl = (...a) => fetch(...a) }) {
  root.innerHTML = MARKUP;
  const $ = (s, el = root) => el.querySelector(s);
  const seatEl = (n) => $(`.su-seat[data-seat="${n}"]`);

  const seats = { 1: null, 2: null };          // { handle, did, bot?, signedIn }
  const hello = { house: false, seat1: false, seat2: false };
  const pending = { 1: null, 2: null };         // a sign-in under way: { abort, timer }
  const history = { 1: null, 2: null };        // saved matches count
  let snapshot = null;
  let result = null;
  let resuming = null;
  const saved = {};                            // `${matchId}:${seat}` → { uri }
  const sprites = new Map();                   // did → promise of a sprite (or null)
  const source = tileSource();                 // 'published' (pinned) or 'memory'
  const changed = new Set();                   // pinned tiles whose record has changed: refused
  root.dataset.tiles = source;

  // ---------- the tiles ----------
  const frames = createFrames({
    makeMothership() {
      const ship = new TileMothership({ loadDomain: TILE_LOAD_DOMAIN });
      const override = loadSourceOverride();
      if (override) ship.getLoadSource = () => override;     // local testing only (see config.js)
      ship.init();
      if (source === 'published') {
        ship.addLoader(createPinnedLoader({ Tile, pins: [PUBLISHED.house, PUBLISHED.player], fetchImpl, onRefused: (uri) => changed.add(uri) }));
      } else {
        const memory = new MemoryTileLoader();
        memory.addTile(MEMORY_IDS.house.slice('memory://'.length), TILES.house);
        memory.addTile(MEMORY_IDS.player.slice('memory://'.length), TILES.player);
        ship.addLoader(memory);
      }
      return ship;
    },
    tileUrlFor: (role) => {
      const which = role === 'house' ? 'house' : 'player';
      return source === 'published' ? PUBLISHED[which].uri : MEMORY_IDS[which];
    },
    mounts: { house: $('.su-house-mount'), seat1: $('.su-mount', seatEl(1)), seat2: $('.su-mount', seatEl(2)) },
    heights: { house: 500, seat1: 620, seat2: 620 },
    times: TIMES,
    onStatus,
    ping: (role, n) => relay.fromPage(role, 'ping', { n }),
  });

  const relay = createRelay({
    deliver: (target, payload) => frames.send(target, payload),
    onPage,
    onLog: log,
  });

  addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d.action !== 'string' || !d.action.startsWith('tiles-protocol-up-')) return;
    const role = frames.roleOf(e.source);
    if (!role) return;                           // not one of our tiles
    frames.heard(role);
    if (d.action === UP) relay.fromTile(role, d.payload);
  });

  function onStatus(role, status, extra) {
    if (role === 'house') return houseStatus(status, extra);
    const n = Number(role.slice(4));
    const box = $('.su-status', seatEl(n));
    const text = status === 'failed' && changed.has(PUBLISHED && PUBLISHED.player.uri) ? CHANGED_TEXT : STATUS_TEXT[status];
    box.hidden = !text;
    if (text) $('p', box).textContent = text;
    $('.su-retry', box).hidden = !['stuck', 'failed', 'stopped'].includes(status);
    if (status === 'stopped' || status === 'loading') {
      hello[role] = false;
      if (seats[n] && hello.house) relay.fromPage('house', 'presence', { seat: n, state: 'gone' });
    }
    if (status === 'ready' && extra.recovered) tileBack(n);   // it spoke up again by itself
    updateSeats();
  }

  function houseStatus(status) {
    const note = $('.su-table-note');
    const text = { loading: 'Opening the table…', slow: 'Still opening the table…', stuck: 'Still opening the table…',
      failed: changed.has(PUBLISHED && PUBLISHED.house.uri) ? CHANGED_TEXT : "The table couldn't open.", stopped: 'The table stopped answering.' }[status];
    note.hidden = !text;
    if (text) $('p', note).textContent = text;
    $('.su-table-retry').hidden = !['stuck', 'failed', 'stopped'].includes(status);
    if (status === 'loading') hello.house = false;
    // While the house is away the players' tables are stale: tell them to wait.
    if (status === 'stopped' || status === 'loading') tellPlayersHouse('gone');
    updateSeats();
  }

  function tellPlayersHouse(state) {
    for (const n of [1, 2]) if (seats[n] && hello[`seat${n}`]) relay.fromPage(`seat${n}`, 'presence', { who: 'house', state });
  }

  for (const n of [1, 2]) $('.su-retry', seatEl(n)).addEventListener('click', () => frames.start(`seat${n}`));
  $('.su-table-retry').addEventListener('click', () => frames.start('house'));

  // ---------- messages for the page ----------
  function onPage(from, p) {
    const n = from === 'house' ? 0 : Number(from.slice(4));
    switch (p.kind) {
      case 'hello':
        hello[from] = true;
        if (from === 'house') houseHello(); else tileBack(n);
        updateSeats();
        break;
      case 'pong': break;
      case 'sprite-request': sendSprite(n); break;
      case 'show-table': showHouse(true); break;
      case 'state':
        snapshot = p.snapshot;
        keepSnapshot();
        break;
      case 'result': result = p.result; root.dataset.result = p.result.matchId; break;
      case 'save-request': saveRequest(n); break;
    }
  }

  const seatPayload = (n) => ({ seat: n, handle: seats[n].handle, ...(seats[n].bot ? { bot: true } : {}) });
  const seatedPayload = (n) => ({ seat: n, handle: seats[n].handle, did: seats[n].did, ...(seats[n].bot ? { bot: true } : {}) });

  // A (re)started house: give it the match back, or seat the players again.
  function houseHello() {
    const resumable = resuming || (snapshot && snapshot.phase !== 'seating' ? snapshot : null);
    resuming = null;
    tellPlayersHouse('back');
    if (resumable) relay.fromPage('house', 'resume', { snapshot: resumable });
    else for (const n of [1, 2]) if (seats[n]) relay.fromPage('house', 'seated', seatedPayload(n));
  }

  // A (re)started or recovered player tile: tell it its seat, and have the house resend the table.
  function tileBack(n) {
    if (!seats[n] || (!hello[`seat${n}`] && frames.status(`seat${n}`) !== 'ready')) return;
    relay.fromPage(`seat${n}`, 'seat', seatPayload(n));
    if (!hello.house) return;
    if (snapshot && snapshot.waitingFor === n - 1) relay.fromPage('house', 'presence', { seat: n, state: 'back' });
    else relay.fromPage('house', 'sync', {});
  }

  // ---------- seats ----------
  function seatState(n, text, bad = false) {
    const el = $('.su-seat-state', seatEl(n));
    el.textContent = text;
    el.classList.toggle('su-bad', bad);
  }

  function describeSeat(n) {
    const s = seats[n];
    if (!s) return;
    if (s.bot) return seatState(n, `@${s.handle} · the bot · keeps no record`);
    const h = history[n];
    const saves = h === null ? '' : h === 0 ? ' · no matches saved yet' : h >= 100 ? ' · 100+ matches saved' : ` · ${h} ${h === 1 ? 'match' : 'matches'} saved`;
    seatState(n, s.signedIn ? `@${s.handle} ✓${saves}` : `@${s.handle} · signed out: sign in again to save`);
  }

  function updateSeats() {
    for (const n of [1, 2]) {
      const el = seatEl(n), form = $('.su-sit', el);
      const taken = !!seats[n], busy = !!pending[n];
      const open = hello.house && hello[`seat${n}`];
      form.classList.toggle('su-taken', taken);
      form.handle.disabled = taken || busy;
      $('.su-sit-go', form).disabled = taken || busy || !open;
      const bot = $('.su-bot', form);
      if (bot) bot.disabled = taken || busy || !open;
      $('.su-cancel', el).hidden = !busy;
      $('.su-again', el).hidden = !(taken && !seats[n].bot && !seats[n].signedIn) || busy;
    }
  }

  for (const n of [1, 2]) {
    const el = seatEl(n);
    $('.su-sit', el).addEventListener('submit', (e) => { e.preventDefault(); takeSeat(n, e.target.handle.value); });
    attachTypeahead($('.su-sit input', el), { fetchImpl, skip: () => !!seats[n] });   // handle suggestions, as in the Foundry
    $('.su-cancel', el).addEventListener('click', () => pending[n] && pending[n].abort());
    $('.su-again', el).addEventListener('click', () => seats[n] && signInAt(n, seats[n].handle, { again: true }));
  }
  $('.su-bot', seatEl(2)).addEventListener('click', playBot);

  // Called from the button press itself: signing in opens a small window, which browsers only allow
  // straight from a click, so nothing here waits before that.
  function takeSeat(n, typed) {
    const handle = cleanHandle(typed);
    if (!looksLikeHandle(handle)) return seatState(n, 'Enter a full handle, like yourname.bsky.social.', true);
    if (handle === BOT.handle) return seatState(n, `For the bot, use “Play against @${BOT.handle}”.`, true);
    const other = seats[n === 1 ? 2 : 1];
    if (other && other.handle === handle) return seatState(n, 'That account already has the other seat.', true);
    if (!hello.house || !hello[`seat${n}`]) return seatState(n, 'The table is still opening…', true);
    if (authProblem || !auth.ready()) return seatState(n, "Signing in isn't working on this page right now. Try reloading.", true);
    const known = rememberedAccounts().find((a) => a.handle === handle && a.did !== BOT.did);
    if (known) return carryOn(n, known);
    signInAt(n, handle);
  }

  // Signed in on this browser before: no window. If that sign-in has run out, it's forgotten, and the
  // next press of the button opens the window (it has to come from a press).
  async function carryOn(n, { did, handle }) {
    pending[n] = { abort() {} };
    seatState(n, `Carrying on as @${handle}…`);
    updateSeats();
    const ok = await auth.restore(did);
    pending[n] = null;
    updateSeats();
    if (ok) return sit(n, { handle, did, signedIn: true });
    seatState(n, `@${handle}'s sign-in on this browser has run out. Press “Sign in and sit” again.`, true);
  }

  function signInAt(n, handle, { again = false, then = null } = {}) {
    const win = auth.openWindow();
    if (!win) return seatState(n, 'The sign-in window was blocked. Allow pop-ups for this page, then try again.', true);
    const ac = new AbortController();
    // No watching for the window to close: the sign-in server cuts the link between the windows for
    // security (its opener policy), so the window looks closed the moment its page loads. The answer
    // comes back another way (the library's BroadcastChannel). Cancel stops a sign-in; the library also
    // gives up by itself after 5 minutes.
    pending[n] = { abort: () => ac.abort(new Error('cancelled')) };
    seatState(n, `Signing in as @${handle}: finish in the small window (or Cancel).`);
    updateSeats();
    auth.signIn(handle, ac.signal)
      .then(async ({ did }) => {
        // The account itself is what counts: it must be the one the typed handle names (someone can
        // switch accounts in the sign-in window), and never the table's bot.
        let named = null;
        try { named = await resolveHandle(handle, fetchImpl); } catch { named = null; }
        if (did === BOT.did) {
          auth.signOut(did);
          return seatState(n, `That's the table's bot. Use “Play against @${BOT.handle}”.`, true);
        }
        if (named !== did) {
          auth.signOut(did);
          return seatState(n, named ? `That sign-in was for a different account than @${handle}. Try again.` : `Couldn't check @${handle}. Try again.`, true);
        }
        if (again && seats[n] && seats[n].did !== did) {
          return seatState(n, `That was a different account. Sign in as @${seats[n].handle} to save.`, true);
        }
        const other = seats[n === 1 ? 2 : 1];
        if (!again && other && other.did === did) return seatState(n, 'That account already has the other seat.', true);
        auth.remember(did, handle);
        if (again && seats[n]) { seats[n].signedIn = true; describeSeat(n); if (then) then(); return; }
        sit(n, { handle, did, signedIn: true });
      })
      .catch((err) => {
        console.warn('[sevenup] sign-in', err);
        seatState(n, ac.signal.aborted ? "Sign-in didn't finish. Try again." : "Sign-in didn't work. Try again.", true);
        if (seats[n]) $('.su-again', seatEl(n)).hidden = false;
      })
      .finally(() => { pending[n] = null; updateSeats(); });
  }

  function sit(n, s) {
    seats[n] = s;
    history[n] = null;
    describeSeat(n);
    updateSeats();
    relay.fromPage(`seat${n}`, 'seat', seatPayload(n));
    relay.fromPage('house', 'seated', seatedPayload(n));
    loadHistory(n);
  }

  function playBot() {
    if (seats[2] || !hello.house || !hello.seat2) return;
    if (seats[1] && seats[1].did === BOT.did) return;
    sit(2, { handle: BOT.handle, did: BOT.did, bot: true, signedIn: false });
  }

  // How many matches this account has saved (public, read from its own server).
  async function loadHistory(n) {
    const s = seats[n];
    if (!s || s.bot) return;
    try {
      const pds = await pdsOf(s.did, fetchImpl);
      const res = await fetchImpl(`${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(s.did)}&collection=${COLLECTION}&limit=100`);
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      if (seats[n] !== s) return;
      history[n] = Array.isArray(body.records) ? body.records.length : 0;
    } catch {
      history[n] = null;                       // no history line; nothing else changes
    }
    describeSeat(n);
  }

  auth.onSignedOut?.((did) => {
    for (const n of [1, 2]) if (seats[n] && seats[n].did === did) { seats[n].signedIn = false; describeSeat(n); }
    updateSeats();
  });

  async function sendSprite(n) {
    const s = seats[n];
    if (!s) return;
    if (!sprites.has(s.did)) sprites.set(s.did, fetchSprite(s.did, fetchImpl).catch((err) => { console.warn('[sevenup] sprite', err); return null; }));
    const sprite = await sprites.get(s.did);
    if (!seats[n] || seats[n].did !== s.did) return;
    if (!sprite) { relay.fromPage(`seat${n}`, 'sprite-status', { state: 'no-sprite' }); return; }
    relay.fromPage(`seat${n}`, 'sprite', {
      handle: s.handle, image: sprite.blob,
      frameWidth: sprite.frameWidth, frameHeight: sprite.frameHeight, sheetWidth: sprite.sheetWidth, sheetHeight: sprite.sheetHeight,
    });
  }

  // ---------- the house, full size ----------
  function showHouse(show) {
    $('.su-house').hidden = !show;
    if (show) $('.su-house-close').focus();
  }
  $('.su-house-close').addEventListener('click', () => showHouse(false));
  $('.su-house').addEventListener('click', (e) => { if (e.target === $('.su-house')) showHouse(false); });

  // ---------- saving: the page's own prompt, outside the tiles ----------
  const dialog = $('.su-dialog');
  let asking = null;                           // { n, record }

  function saveRequest(n) {
    const s = seats[n];
    if (!result || !s || s.bot) return;
    const key = `${result.matchId}:${n}`;
    if (saved[key]) return relay.fromPage(`seat${n}`, 'save-status', { state: 'saved', handle: s.handle });
    const record = recordFor(result, n, HOUSE_ADDRESS);
    const problem = checkRecord(record);
    if (problem) { console.error('[sevenup] record problem', problem, record); return relay.fromPage(`seat${n}`, 'save-status', { state: 'failed' }); }
    asking = { n, record, key };
    const other = otherPlayer(result, n);
    $('#su-dialog-title').textContent = `Save this match to @${s.handle}?`;
    $('.su-dialog-text').textContent =
      `This adds a public record to @${s.handle}'s account (a Seven-Up match record and nothing else). ` +
      (other.bot ? `It mentions @${other.handle}, the bot you played.` : `It mentions @${other.handle}, who played the other seat.`);
    $('.su-dialog-record').textContent = JSON.stringify(record, null, 2);
    $('.su-dialog-details').open = false;
    setDialog('', s.signedIn ? 'Save' : 'Sign in and save', 'Not now');
    dialog.hidden = false;
    $('.su-dialog-yes').focus();
    relay.fromPage(`seat${n}`, 'save-status', { state: 'asking' });
  }

  function setDialog(status, yes, no, link = null) {
    const st = $('.su-dialog-status');
    st.textContent = status;
    if (link) {
      const a = document.createElement('a');
      a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'See the record ↗';
      st.append(' ', a);
    }
    $('.su-dialog-yes').hidden = !yes;
    if (yes) $('.su-dialog-yes').textContent = yes;
    $('.su-dialog-no').textContent = no;
  }

  $('.su-dialog-yes').addEventListener('click', () => {
    if (!asking) return;
    const { n } = asking;
    if (!seats[n].signedIn) return signInAt(n, seats[n].handle, { again: true, then: () => doSave() });   // from the click
    doSave();
  });
  $('.su-dialog-no').addEventListener('click', closeDialog);
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!dialog.hidden) closeDialog();
    else if (!$('.su-house').hidden) showHouse(false);
  });

  function closeDialog() {
    if (asking && !saved[asking.key]) relay.fromPage(`seat${asking.n}`, 'save-status', { state: 'declined' });
    asking = null;
    dialog.hidden = true;
  }

  async function doSave() {
    if (!asking) return;
    const { n, record, key } = asking;
    const s = seats[n];
    $('.su-dialog-yes').disabled = true;
    setDialog('Saving…', 'Save', 'Not now');
    relay.fromPage(`seat${n}`, 'save-status', { state: 'saving' });
    try {
      const { uri } = await auth.putRecord(s.did, { collection: COLLECTION, rkey: record.matchId, record });
      saved[key] = { uri };
      if (history[n] !== null) history[n] += 1;
      describeSeat(n);
      $('#su-dialog-title').textContent = 'Match saved';
      setDialog(`Saved to @${s.handle}.`, null, 'Close', uri ? recordLink(uri) : null);
      relay.fromPage(`seat${n}`, 'save-status', { state: 'saved', handle: s.handle });
    } catch (err) {
      if (err instanceof SignInNeeded) {
        s.signedIn = false;
        describeSeat(n);
        setDialog(`@${s.handle}'s sign-in has run out. Sign in again to save; the match is kept until this page closes.`, 'Sign in and save', 'Not now');
        relay.fromPage(`seat${n}`, 'save-status', { state: 'signin' });
      } else {
        console.error('[sevenup] save failed', err);
        setDialog("Couldn't save. Try again.", 'Try again', 'Not now');
        relay.fromPage(`seat${n}`, 'save-status', { state: 'failed' });
      }
    } finally {
      $('.su-dialog-yes').disabled = false;
      updateSeats();
    }
  }

  // ---------- resume after a reload ----------
  function keepSnapshot() {
    try { localStorage.setItem(RESUME_KEY, JSON.stringify({ savedAt: Date.now(), snapshot })); } catch { /* no storage: no resume */ }
  }

  const fitsTable = (s) => s && (s.bot ? s.did === BOT.did && s.handle === BOT.handle
    : typeof s.did === 'string' && /^did:[a-z]+:[A-Za-z0-9._:%-]+$/.test(s.did) && s.did !== BOT.did && looksLikeHandle(s.handle || ''));

  function offerResume() {
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null'); } catch { kept = null; }
    if (!kept || !kept.snapshot || typeof kept.savedAt !== 'number' || Date.now() - kept.savedAt > TIMES.resumeFor) return;
    const snap = kept.snapshot;
    if (snap.phase === 'seating' || !Array.isArray(snap.seats) || !snap.seats.every(fitsTable)) return;
    const box = $('.su-resume');
    $('.su-resume-text', box).textContent = `Resume the match between @${snap.seats[0].handle} and @${snap.seats[1].handle}?`;
    box.hidden = false;
    $('.su-resume-yes', box).onclick = async () => {
      box.hidden = true;
      snap.seats.forEach((s, i) => { seats[i + 1] = { handle: s.handle, did: s.did, bot: !!s.bot, signedIn: false }; describeSeat(i + 1); });
      updateSeats();
      for (const n of [1, 2]) if (hello[`seat${n}`]) relay.fromPage(`seat${n}`, 'seat', seatPayload(n));
      if (hello.house) relay.fromPage('house', 'resume', { snapshot: snap });
      else resuming = snap;
      // Each person's sign-in from before, if it's still good (else they sign in again to save).
      for (const n of [1, 2]) {
        const s = seats[n];
        if (s.bot || !auth.ready()) continue;
        s.signedIn = await auth.restore(s.did);
        describeSeat(n);
        loadHistory(n);
      }
      updateSeats();
    };
    $('.su-resume-no', box).onclick = () => {
      box.hidden = true;
      try { localStorage.removeItem(RESUME_KEY); } catch { /* fine */ }
    };
  }

  // ---------- the log ----------
  const logList = $('.su-log ol');
  const logCount = $('.su-log-count');
  const t0 = performance.now();
  let logged = 0;
  function log(e) {
    if (QUIET_KINDS.includes(e.kind)) return;
    const li = document.createElement('li');
    const time = ((performance.now() - t0) / 1000).toFixed(1);
    li.textContent = e.dir === 'drop'
      ? `${time}  ✕ ${e.from} ${e.kind ?? '?'} refused: ${e.why}`
      : `${time}  ${e.from} → ${e.to ?? 'page'}  ${e.kind}${e.bytes > 1000 ? `  (${(e.bytes / 1024).toFixed(1)} KB)` : ''}`;
    if (e.dir === 'drop') li.className = 'su-drop';
    logList.append(li);
    while (logList.children.length > 500) logList.firstChild.remove();
    logCount.textContent = `(${++logged})`;
    if (root.dataset.keepLog) (window.__sevenupLog ||= []).push(e);
  }

  // ---------- start ----------
  updateSeats();
  frames.start('house');
  frames.start('seat1');
  frames.start('seat2');
  offerResume();
  return { seats, hello, frames, relay, saved: () => saved, result: () => result, snapshot: () => snapshot };
}
