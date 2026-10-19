// table.js: one seat at a Daisy table. Loads three tiles through the tile loader (this seat's hidden
// house, your player tile and a copy watching the other seat), passes their messages along (router.js
// stamps each with its sender), connects to the relay so the two houses can talk, keeps the house's
// state in this browser for a reload, watches the tiles' health and logs what passes between the pages.
// Step 4: you sign in to sit (auth.js), save a finished match when you ask (the page's own prompt,
// outside the tiles), the tiles come pinned once published, and the two pages check they run the same
// house before the table starts.
// Step 5: the live page plays through the real relay on Fly.io (RELAY_URL in config.js); on this
// computer the stand-in stays the default.
// Step 6: the lounge (lounge.js) on the start screen; an invitation both said yes to opens a table here.
// Step 7: Play the bot. The bot (@dicesprite.thunderbird.cafe) sits at seat 2 in a second copy of the house
// ("bot"), run hidden on this page: the page passes the two houses' messages to each other (no relay),
// with no timers. Its state is kept in this browser with yours, so a reload picks the match up again.
//
// mountTable(root, deps): deps carries the loader classes and the sign-in (and stand-ins for the checks),
// so this file has no package imports.
import { MARKUP } from './markup.js';
import { createRouter } from './router.js';
import { createFrames } from './frames.js';
import { connectRelay } from './connection.js';
import { keep, kept, tabAccount, forgetOld, inProgress } from './storage.js';
import { cleanHandle, looksLikeHandle, resolveHandle } from './identity.js';
import { SignInNeeded, rememberedAccounts } from './auth.js';
import { createPinnedLoader } from './pinned-loader.js';
import { attachTypeahead } from './typeahead.js';
import { recordFor, otherPlayer, checkRecord } from './record.js';
import { mountLounge } from './lounge.js';
import { TILES } from './tiles.generated.js';
import {
  TILE_LOAD_DOMAIN, MEMORY_IDS, TIMES, AWAY_MS, relayUrl, loungeUrl, timerSet, loadSourceOverride, newTableId,
  PUBLISHED, tileSource, houseVersion, houseAddress, COLLECTION, recordLink, BOT,
} from './config.js';

const UP = 'tiles-protocol-up-data-payload';
const STATUS_TEXT = {
  loading: 'Loading the tile…', slow: 'Still loading…', stuck: 'Still loading…',
  failed: "This tile couldn't be loaded.", stopped: 'This tile stopped answering.',
};
const CHANGED_TEXT = 'This tile has changed since the table was set up, so the table won\'t use it.';
const MISMATCH_TEXT = 'The other page has a different version of Daisy, so the table can\'t start. Reload this page to get the latest (the other player may need to as well).';
const at = (h) => (h ? '@' + h : 'the other player');
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function mountTable(root, { TileMothership, MemoryTileLoader, Tile, auth, authProblem = null, WebSocketImpl = globalThis.WebSocket, fetchImpl = (...a) => fetch(...a), loc = globalThis.location } = {}) {
  root.innerHTML = MARKUP;
  const $ = (s, el = root) => el.querySelector(s);
  const params = new URLSearchParams(loc.search);
  const timers = timerSet(loc);
  const relayAt = relayUrl(loc);
  forgetOld();
  const source = tileSource(loc);           // 'published' (pinned) or 'memory'
  const myHouse = houseVersion(source);     // the house version check
  const changed = new Set();                // pinned tiles whose record has changed: refused
  root.dataset.tiles = source;

  let table = params.get('table');
  if (table && !/^[a-z0-9]{8,32}$/.test(table)) table = null;
  let me = null;               // { did, handle, seat, signedIn }
  let other = null;            // { did, handle, here }
  let snapshot = null;         // the house's latest state (kept in this browser)
  let houseReady = false;      // the house has been set up
  let houseSaid = false;       // the house said hello (this load of it)
  let relay = null;
  let lastView = null;
  let goneAt = 0, goneTimer = null;
  let phase = null;
  let result = null;
  let problem = null;          // a lasting problem to show (e.g. the pages' timers differ)
  let myView = null;           // the latest shared view of your die (sent again after a reconnect)
  let theirView = null;        // the other player's latest, for your watching copy
  let joinedHere = false;      // this page already sat down (a reconnect is never "fresh")
  let mismatch = false;        // the other page runs a different house: nothing passes between them
  let busy = null;             // a sign-in under way: { abort }
  const saved = {};            // matchId → { uri }
  let vsBot = false;           // this table is against the bot (step 7)
  let botSnapshot = null;      // the bot's house state (kept in this browser with yours)
  let botReady = false, botSaid = false;
  // What this browser keeps for the table (storage.js): your seat, your house's state and, against the
  // bot, its house's state too.
  const remember = () => { if (me && table) keep(table, { me, other, snapshot, ...(vsBot ? { vsBot: true, bot: botSnapshot } : {}) }); };
  const hello = { mine: false, theirs: false };

  // ---------- the tiles ----------
  const frames = createFrames({
    makeMothership() {
      const ship = new TileMothership({ loadDomain: TILE_LOAD_DOMAIN });
      const override = loadSourceOverride(loc);
      if (override) ship.getLoadSource = () => override;
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
      const which = role === 'house' || role === 'bot' ? 'house' : 'player';
      return source === 'published' ? PUBLISHED[which].uri : MEMORY_IDS[which];
    },
    mounts: { house: $('.dz-house-mount'), mine: $('.dz-mine .dz-mount'), theirs: $('.dz-theirs .dz-mount'), bot: $('.dz-bot-mount') },
    heights: { house: 200, mine: 560, theirs: 560, bot: 200 },
    times: TIMES,
    onStatus,
    ping: (role, n) => router.fromPage(role, 'ping', { n }),
  });

  const router = createRouter({
    deliver(target, payload) {
      if (payload.kind === 'view' && target === 'mine') lastView = payload;
      if (payload.kind === 'view' && target === 'mine' && payload.view) onView(payload.view);
      frames.send(target, payload);
    },
    // Against the bot, your house's messages for the other house go to the bot's house on this page.
    toRelay: (data) => (vsBot ? router.toBot(data) : relay && !mismatch && relay.send(data)),
    onPage,
    onLog: log,
  });

  addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d.action !== 'string' || !d.action.startsWith('tiles-protocol-up-')) return;
    const role = frames.roleOf(e.source);
    if (!role) return;
    frames.heard(role);
    if (d.action === UP) router.fromTile(role, d.payload);
  });

  function onStatus(role, status, extra) {
    if (role === 'bot') {
      // The bot's house: the same note as the house's (it's part of the table), Try again restarts it.
      const note = $('.dz-house-note');
      const text = { slow: 'Still opening the table…', stuck: 'Still opening the table…', failed: "The bot couldn't start.", stopped: 'The bot stopped answering.' }[status];
      if (status === 'loading' || status === 'stopped') { botSaid = false; botReady = false; }
      if (text) { note.hidden = false; $('p', note).textContent = text; $('.dz-house-retry').hidden = !['stuck', 'failed', 'stopped'].includes(status); retryRole = 'bot'; }
      else if (retryRole === 'bot') { note.hidden = true; retryRole = 'house'; }
      return;
    }
    if (role === 'house') {
      const note = $('.dz-house-note');
      const text = { loading: '', slow: 'Still opening the table…', stuck: 'Still opening the table…',
        failed: changed.has(PUBLISHED && PUBLISHED.house.uri) ? CHANGED_TEXT : "The table couldn't open.", stopped: 'The table stopped answering.' }[status];
      note.hidden = !text;
      if (text) { $('p', note).textContent = text; retryRole = 'house'; }
      $('.dz-house-retry').hidden = !['stuck', 'failed', 'stopped'].includes(status);
      if (status === 'loading' || status === 'stopped') { houseSaid = false; houseReady = false; tellPlayersHouse('gone'); }
      return;
    }
    const box = $(`.dz-seat[data-role="${role}"] .dz-tile-status`);
    const text = status === 'failed' && changed.has(PUBLISHED && PUBLISHED.player.uri) ? CHANGED_TEXT : STATUS_TEXT[status];
    box.hidden = !text;
    if (text) $('p', box).textContent = text;
    $('.dz-retry', box).hidden = !['stuck', 'failed', 'stopped'].includes(status);
    if (status === 'loading') hello[role] = false;
    if (status === 'ready' && extra.recovered) introduce(role);
  }
  for (const role of ['mine', 'theirs']) $(`.dz-seat[data-role="${role}"] .dz-retry`).addEventListener('click', () => frames.start(role));
  let retryRole = 'house';
  $('.dz-house-retry').addEventListener('click', () => frames.start(retryRole));
  const tellPlayersHouse = (state) => { for (const r of ['mine', 'theirs']) if (hello[r]) router.fromPage(r, 'presence', { who: 'house', state }); };

  // ---------- messages for the page ----------
  function onPage(from, p) {
    if (from === 'bot') return onBot(p);
    switch (p.kind) {
      case 'hello':
        if (from === 'house') { houseSaid = true; setupHouse(); } else { hello[from] = true; introduce(from); }
        break;
      case 'pong': break;
      case 'die-view': {
        const { game, v, from: f, kind, ...view } = p;
        if (from === 'mine') myView = view; else { theirView = view; }
        break;
      }
      case 'state':
        snapshot = p.snapshot;
        remember();
        break;
      case 'resumed': log({ dir: 'page', from: 'house', kind: 'resumed', note: 'picked up from this browser' }); break;
      case 'result':
        result = p.result;
        root.dataset.result = p.result.matchId;
        log({ dir: 'page', from: 'house', kind: 'result', note: `match over: seat ${p.result.winner} won${p.result.ending === 'forfeit' ? ' by forfeit' : ''}` });
        break;
      case 'save-request': if (from === 'mine') saveRequest(); break;
      case 'ignored':
        if (p.why === 'different timers') { problem = 'The other page uses different timers, so the table can\'t start. Both pages need ?timers=short, or neither.'; updateStatus(); }
        if (p.why === 'the other page started over') { problem = `${at(other && other.handle)}'s page started over without its saved game, so this game can't go on. It ends by forfeit when the timer runs out.`; updateStatus(); }
        if (!['already had it'].includes(p.why)) log({ dir: 'drop', from: 'house', kind: p.about, why: p.why });
        break;
    }
  }

  // The player tiles: yours, and the copy watching the other seat.
  function introduce(role) {
    if (!hello[role] || !me || !me.seat) return;
    if (role === 'mine') router.fromPage('mine', 'seat', { seat: me.seat, handle: me.handle, watching: false });
    else router.fromPage('theirs', 'seat', { seat: me.seat === 1 ? 2 : 1, handle: other ? other.handle : null, watching: true });
    if (lastView) frames.send(role, lastView);
    if (role === 'theirs' && theirView) frames.send('theirs', { ...theirView, game: 'daisy', v: 1, kind: 'die-view', from: 'peer' });
    if (houseReady && houseSaid) router.fromPage(role, 'presence', { who: 'house', state: 'back' });
    if (role === 'mine' && result && saved[result.matchId]) router.fromPage('mine', 'save-status', { state: 'saved', handle: me.handle });
    if (role === 'mine') tellOther();
  }
  // Your tile hears whether the other player's page is still at the table (step 7: the end screen says so,
  // and offers no Rematch when nobody is there to agree).
  function tellOther() {
    if (hello.mine && other) router.fromPage('mine', 'presence', { who: 'other', state: other.here ? 'back' : 'gone' });
  }

  // The house: set up once both it and the relay are ready (or hand it back its kept state).
  function setupHouse() {
    if (!houseSaid || houseReady || !me || !me.seat) return;
    houseReady = true;
    router.fromPage('house', 'setup', { seat: me.seat, timers: vsBot ? 'bot' : timers, snapshot: snapshot || undefined });
    router.fromPage('house', 'seated', { seat: me.seat, did: me.did, handle: me.handle });
    if (other) router.fromPage('house', 'seated', { seat: other.seat, did: other.did, handle: other.handle, ...(vsBot ? { bot: true } : {}) });
    if (other && !other.here) router.fromPage('house', 'presence', { seat: other.seat, state: 'gone' });
    router.fromPage('house', 'reconnected');
    tellPlayersHouse('back');
  }
  setInterval(() => { if (houseReady) router.fromPage('house', 'tick'); }, TIMES.tick);

  // ---------- the bot's house (step 7) ----------
  function onBot(p) {
    switch (p.kind) {
      case 'hello': botSaid = true; setupBot(); break;
      case 'state': botSnapshot = p.snapshot; remember(); break;
      case 'resumed': log({ dir: 'page', from: 'bot', kind: 'resumed', note: 'the bot picked up from this browser' }); break;
      case 'ignored': if (!['already had it'].includes(p.why)) log({ dir: 'drop', from: 'bot', kind: p.about, why: p.why }); break;
    }
  }
  function setupBot() {
    if (!vsBot || !botSaid || botReady || !me || !me.seat) return;
    botReady = true;
    router.fromPage('bot', 'setup', { seat: 2, timers: 'bot', bot: true, snapshot: botSnapshot || undefined });
    router.fromPage('bot', 'seated', { seat: 1, did: me.did, handle: me.handle });
    router.fromPage('bot', 'seated', { seat: 2, did: BOT.did, handle: BOT.handle, bot: true });
    router.fromPage('bot', 'reconnected');           // ask your house for anything it sent before the bot was ready
  }

  // ---------- the relay ----------
  function connect() {
    if (!relayAt) { setStatus('There\'s no relay to play through, so this table can\'t open.'); return; }
    relay = connectRelay({
      url: relayAt, WebSocketImpl,
      // fresh: this browser has none of the seat's kept state, so it mustn't take over a seat in play.
      joinMessage: () => ({ type: 'join', table, seat: me.seat || me.ask || 'any', did: me.did, handle: me.handle, house: myHouse, fresh: !snapshot && !joinedHere }),
      onState(state) {
        if (state === 'down') setStatus('Lost the connection to the table. Reconnecting…');
        if (state === 'connecting' && !me.seat) setStatus('Joining the table…');
      },
      onMessage(m) {
        switch (m.type) {
          case 'joined':
            joinedHere = true;
            me.seat = m.seat;
            if (m.other) other = { ...m.other, seat: m.seat === 1 ? 2 : 1 };
            remember();
            tellOther();
            if (m.other) checkHouse(m.other.house);
            showTable();
            introduce('mine'); introduce('theirs');
            if (houseReady) {
              if (other) router.fromPage('house', 'seated', { seat: other.seat, did: other.did, handle: other.handle });
              router.fromPage('house', 'presence', { seat: me.seat === 1 ? 2 : 1, state: other && other.here ? 'back' : 'gone' });
              router.fromPage('house', 'reconnected');
            } else setupHouse();
            if (myView && other && other.here && !mismatch) relay.send({ kind: 'die-view', ...myView });
            updateStatus();
            break;
          case 'presence':
            other = { did: m.did, handle: m.handle, seat: m.seat, here: m.state === 'here', house: m.house };
            remember();
            tellOther();
            if (m.state === 'here') checkHouse(m.house);
            if (houseReady) {
              router.fromPage('house', 'seated', { seat: m.seat, did: m.did, handle: m.handle });
              router.fromPage('house', 'presence', { seat: m.seat, state: m.state === 'here' ? 'back' : 'gone' });
              if (m.state === 'here') router.fromPage('house', 'reconnected');
            }
            introduce('theirs');
            if (m.state === 'here' && myView && !mismatch) relay.send({ kind: 'die-view', ...myView });   // the shared view again
            goneAt = m.state === 'here' ? 0 : Date.now();
            updateStatus();
            break;
          case 'peer': if (!mismatch) router.fromRelay(m.data); break;
          case 'full': setStatus('This table is full: two players are already sitting at it.'); hideTable(); break;
          case 'replaced': setStatus('You opened this seat in another window, so this one has stepped away.'); hideTable(); break;
          case 'held':
            setStatus(`@${me.handle} already sits at this table in another browser. Its game, and the secret it needs for the dice, live there: open the table in that browser to keep playing.`);
            frames.stop && frames.stop();
            hideTable();
            break;
          case 'error': log({ dir: 'drop', from: 'relay', kind: 'error', why: m.why }); break;
        }
      },
    });
  }

  // The house version check: both pages must run the same referee, or nothing passes between them and the
  // table doesn't start (a page that names no version counts as different). Player tiles may differ.
  function checkHouse(theirs) {
    if (mismatch || theirs === myHouse) return;
    mismatch = true;
    root.dataset.mismatch = '1';
    log({ dir: 'drop', from: 'relay', kind: 'house', why: `the other page runs house ${theirs || '(unnamed)'}, this one ${myHouse}` });
    problem = MISMATCH_TEXT;
    hideTable();
    updateStatus();
  }

  // ---------- what this page shows ----------
  function onView(v) { phase = v.phase; updateStatus(); $('.dz-after').hidden = !(phase === 'over' || phase === 'abandoned'); }

  // ---------- back to the start (owner, Oct 18): from any table to the start screen and the lounge ----------
  // The table stays kept in this browser for a day, so its link still leads back to it.
  function startUrl() {
    const u = new URL(loc.href);
    u.search = '';
    for (const k of ['tiles', 'timers', 'relay', 'loader']) if (params.get(k)) u.searchParams.set(k, params.get(k));
    return u.toString();
  }
  const goHome = () => { try { relay && relay.stop(); } catch {} loc.assign(startUrl()); };
  const underWay = () => ['flipping', 'playing'].includes(phase) && !result;
  function backToStart() {
    if (!underWay() || vsBot) return goHome();        // against the bot the match simply waits (no timers)
    $('.dz-leave').hidden = false;          // during a match, ask first (the away rule, said plainly)
    $('.dz-leave-no').focus();
  }
  $('.dz-home').addEventListener('click', backToStart);
  $('.dz-after-lounge').addEventListener('click', goHome);
  $('.dz-leave-yes').addEventListener('click', goHome);
  $('.dz-leave-no').addEventListener('click', () => { $('.dz-leave').hidden = true; });
  function updateStatus() {
    clearInterval(goneTimer);
    if (!me || !me.seat) return;
    if (problem) { setStatus(problem); return; }
    if (vsBot) { setStatus(phase === 'over' ? `Match over · playing @${BOT.handle}, the table's bot` : `Playing @${BOT.handle}, the table's bot`); return; }
    if (other && !other.here && goneAt && phase !== 'over' && phase !== 'abandoned') {
      const awayFor = AWAY_MS[timers];
      const show = () => setStatus(`${at(other.handle)} lost connection. Waiting… ${mmss(awayFor - (Date.now() - goneAt))}`);
      show();
      goneTimer = setInterval(show, 1000);
      return;
    }
    if (!other) { setStatus(me.fromLounge ? 'Waiting for the other player to arrive…' : 'Waiting for the other player. Send them the link.'); return; }
    if (mismatch) return;
    $('.dz-invite').hidden = true;
    setStatus(phase === 'over' ? `Match over · playing with ${at(other.handle)}` : `Playing with ${at(other.handle)}${timers === 'short' ? ' · short timers' : ''}`);
  }
  function setStatus(text) { const s = $('.dz-status'); s.hidden = !text; s.textContent = text || ''; }
  function showTable() {
    $('.dz-lobby').hidden = true;
    $('.dz-play').hidden = true;
    if (mismatch) return;
    $('.dz-table').hidden = false;
    if (me.seat === 1 && !other && !me.fromLounge) {
      $('.dz-invite').hidden = false;
      $('.dz-link').value = shareLink();
    }
  }
  function hideTable() { $('.dz-table').hidden = true; $('.dz-invite').hidden = true; }
  function shareLink() {
    const u = new URL(loc.href);
    u.search = '';
    u.searchParams.set('table', table);
    for (const k of ['tiles', 'timers', 'relay', 'loader']) if (params.get(k)) u.searchParams.set(k, params.get(k));
    return u.toString();
  }
  $('.dz-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('.dz-link').value); $('.dz-copy').textContent = 'Copied'; }
    catch { $('.dz-link').select(); }
  });

  function start(seatWish) {
    me.ask = seatWish;
    if (lounge) lounge.leaveForTable(); else $('.dz-lounge').hidden = true;
    showAccount();
    frames.start('house'); frames.start('mine'); frames.start('theirs');
    if (vsBot) return startBot();
    connect();
  }
  // Against the bot: no relay. You sit at seat 1 and the bot at seat 2, both houses on this page.
  function startBot() {
    me.seat = 1;
    other = { did: BOT.did, handle: BOT.handle, seat: 2, here: true, bot: true };
    remember();
    frames.start('bot');
    showTable();
    introduce('mine'); introduce('theirs');
    setupHouse(); setupBot();
    updateStatus();
  }

  // ---------- the start screen: one sign-in first (owner, Oct 18, option B) ----------
  // The page signs in once, at the top ("Play Daisy"); Open a table, Take a seat and the Lounge all use
  // that sign-in. Mingling asks once more, for "Daisy lounge", the first time only (lounge.js).
  let who = null;              // the account signed in on the start screen
  const note = (text) => { $('.dz-lobby-note').textContent = text || ''; };
  attachTypeahead($('.dz-handle'), { fetchImpl, skip: () => !!busy });     // handle suggestions, as in the Foundry and Seven-Up
  const last = rememberedAccounts()[0];
  if (last && !$('.dz-handle').value) $('.dz-handle').value = last.handle;

  function lobbyBusy(on, abort = null) {
    busy = on ? { abort } : null;
    $('.dz-signin').disabled = on;
    $('.dz-handle').disabled = on;
    $('.dz-cancel').hidden = !(on && abort);
  }
  $('.dz-cancel').addEventListener('click', () => busy && busy.abort && busy.abort());

  // Called from the button press itself: signing in opens a small window, which browsers only allow
  // straight from a click, so nothing here waits before that. then(who) runs once signed in.
  function signInToSit(then) {
    const handle = cleanHandle($('.dz-handle').value);
    if (!looksLikeHandle(handle)) return note('Type your handle, like you.bsky.social.');
    if (authProblem || !auth || !auth.ready()) return note("Signing in isn't working on this page right now. Try reloading.");
    const known = rememberedAccounts().find((a) => a.handle === handle);
    if (known) return carryOn(known, then);
    signInWindow(handle, then);
  }

  // Signed in on this browser before: no window. If that sign-in has run out it's forgotten, and the next
  // press opens the window (it has to come from a press).
  async function carryOn({ did, handle }, then) {
    lobbyBusy(true);
    note(`Carrying on as @${handle}…`);
    const ok = await auth.restore(did);
    lobbyBusy(false);
    if (!ok) return note(`@${handle}'s sign-in on this browser has run out. Press the button again to sign in.`);
    note('');
    then({ did, handle, signedIn: true });
  }

  function signInWindow(handle, then, { expect = null } = {}) {
    const win = auth.openWindow();
    if (!win) { note('The sign-in window was blocked. Allow pop-ups for this page, then try again.'); return false; }
    const ac = new AbortController();
    // No watching for the window to close: the sign-in server cuts the link between the windows (its
    // opener policy). The answer comes back through the library; Cancel stops it (it also gives up after
    // 5 minutes by itself).
    lobbyBusy(true, () => ac.abort(new Error('cancelled')));
    note(`Signing in as @${handle}: finish in the small window (or Cancel).`);
    auth.signIn(handle, ac.signal)
      .then(async ({ did }) => {
        // The account itself is what counts: it must be the one the typed handle names (someone can
        // switch accounts in the sign-in window).
        let named = null;
        try { named = await resolveHandle(handle, fetchImpl); } catch { named = null; }
        if (named !== did) {
          auth.signOut(did);
          return note(named ? `That sign-in was for a different account than @${handle}. Try again.` : `Couldn't check @${handle}. Try again.`);
        }
        if (expect && expect !== did) return note(`That was a different account. Sign in as @${handle}.`);
        auth.remember(did, handle);
        note('');
        then({ did, handle, signedIn: true });
      })
      .catch((err) => {
        console.warn('[daisy] sign-in', err);
        note(ac.signal.aborted ? "Sign-in didn't finish. Try again." : "Sign-in didn't work. Try again.");
      })
      .finally(() => lobbyBusy(false));
    return true;
  }

  // Signed in (or not) on the start screen: the line at the top, and what can be pressed.
  function showStart() {
    if (me) return;                          // at a table: showAccount() keeps the line
    $('.dz-lobby').hidden = !!who;
    for (const b of ['.dz-open', '.dz-sit', '.dz-bot']) $(b).disabled = !who;
    $('.dz-play').classList.toggle('dz-waiting', !who);
    const line = $('.dz-account');
    line.hidden = !who;
    if (who) $('.dz-account-text').textContent = `Signed in as @${who.handle}`;
    $('.dz-signout').hidden = !who;
    $('.dz-again').hidden = true;
    $('.dz-home').hidden = true;
    showGoing();
    if (lounge) lounge.setAccount(who);
  }
  // Unfinished matches this browser keeps for the signed-in account (owner, Oct 18).
  function showGoing() {
    const list = $('.dz-going');
    list.textContent = '';
    const going = who && !table ? inProgress(who.did) : [];
    list.hidden = !going.length;
    for (const g of going) {
      const li = document.createElement('li');
      const u = new URL(startUrl());
      u.searchParams.set('table', g.table);
      if (g.bot) u.searchParams.set('bot', '1');
      const a = Object.assign(document.createElement('a'), { href: u.toString(), textContent: 'Back to the table' });
      li.append(`You have a match in progress with @${g.with}.`, a);
      list.append(li);
    }
  }
  $('.dz-signin').addEventListener('click', () => signInToSit((w) => { who = { did: w.did, handle: w.handle }; showStart(); }));
  $('.dz-handle').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !busy) $('.dz-signin').click(); });

  $('.dz-open').addEventListener('click', () => {
    if (!who) return;
    table = newTableId();
    const u = new URL(loc.href);
    u.searchParams.set('table', table);
    try { history.replaceState(null, '', u); } catch {}
    me = { ...who, signedIn: true, seat: null };
    start(1);
  });
  // Play the bot (step 7): a new table of your own, the bot at seat 2.
  $('.dz-bot').addEventListener('click', () => {
    if (!who) return;
    table = newTableId();
    const u = new URL(loc.href);
    u.searchParams.set('table', table);
    u.searchParams.set('bot', '1');
    try { history.replaceState(null, '', u); } catch {}
    vsBot = true;
    me = { ...who, signedIn: true, seat: 1 };
    start(1);
  });
  $('.dz-sit').addEventListener('click', () => {
    if (!who) return;
    const mine = kept(table).find((k) => k.me.did === who.did);
    me = mine ? { ...mine.me, signedIn: true } : { ...who, signedIn: true, seat: null };
    if (mine) { snapshot = mine.snapshot; other = mine.other; }
    start('any');
  });

  // The lounge (step 6): only on the start screen. An invitation both said yes to: straight to its table,
  // the inviter at seat 1 and the one who said yes at seat 2 (owner, Oct 18).
  let lounge = null;
  if (!table) {
    lounge = mountLounge(root, {
      auth, authProblem, url: loungeUrl(loc), WebSocketImpl, fetchImpl, log, loc,
      onTable({ table: id, seat, did, handle }) {
        table = id;
        const u = new URL(loc.href);
        u.searchParams.set('table', table);
        try { history.replaceState(null, '', u); } catch {}
        me = { did, handle, signedIn: true, seat: null, fromLounge: true };
        start(seat);
      },
    });
  } else $('.dz-lounge').hidden = true;

  // Back at a seat from this browser (a reload): carry on with that account's sign-in if it's still good;
  // if not, the game goes on and saving asks to sign in again.
  async function backAt(k) {
    me = { ...k.me, signedIn: false }; other = k.other ? { ...k.other, here: false } : null; snapshot = k.snapshot;
    if (k.vsBot) { vsBot = true; botSnapshot = k.bot || null; }
    setStatus('Back at your seat…');
    start(me.seat);
    if (auth && auth.ready() && !authProblem) me.signedIn = await auth.restore(me.did);
    showAccount();
  }

  // ---------- your account, once seated ----------
  function showAccount() {
    if (!me) return;
    const line = $('.dz-account');
    line.hidden = false;
    $('.dz-home').hidden = false;
    $('.dz-account-text').textContent = me.signedIn ? `Signed in as @${me.handle}` : `@${me.handle} · signed out on this browser: sign in again to save`;
    $('.dz-signout').hidden = !me.signedIn;
    $('.dz-again').hidden = me.signedIn;
  }
  // Sign out: this browser forgets the account's sign-in (and it's ended at its server). At a table the
  // seat and the game stay, and saving asks to sign in again; on the start screen, back to signing in (a
  // lounge record stays in the account: mingling resumes at the next sign-in).
  $('.dz-signout').addEventListener('click', async () => {
    if (!me && who) {
      const was = who;
      who = null;
      showStart();
      try { await auth.signOut(was.did); } catch (err) { console.warn('[daisy] sign-out', err); }
      return;
    }
    if (!me || !me.signedIn) return;
    me.signedIn = false;
    try { await auth.signOut(me.did); } catch (err) { console.warn('[daisy] sign-out', err); }
    showAccount();
  });
  $('.dz-again').addEventListener('click', () => signInAgain());
  function signInAgain(then = () => {}) {
    if (!me || authProblem || !auth || !auth.ready()) return;
    const win = auth.openWindow();
    if (!win) { $('.dz-account-text').textContent = 'The sign-in window was blocked. Allow pop-ups for this page, then try again.'; return; }
    const ac = new AbortController();
    $('.dz-account-text').textContent = `Signing in as @${me.handle}: finish in the small window.`;
    auth.signIn(me.handle, ac.signal)
      .then(({ did }) => {
        if (did !== me.did) { auth.signOut(did); $('.dz-account-text').textContent = `That was a different account. Sign in as @${me.handle}.`; return; }
        auth.remember(did, me.handle);
        me.signedIn = true;
        showAccount();
        then();
      })
      .catch((err) => { console.warn('[daisy] sign-in', err); showAccount(); });
  }
  auth && auth.onSignedOut && auth.onSignedOut((did) => { if (me && me.did === did) { me.signedIn = false; showAccount(); } });

  // ---------- saving: the page's own prompt, outside the tiles (Oct 18, option A) ----------
  const dialog = $('.dz-dialog');
  let asking = null;                           // { record }
  const tellMine = (state, extra = {}) => { if (hello.mine) router.fromPage('mine', 'save-status', { state, ...extra }); };

  function saveRequest() {
    if (!result || !me || !me.seat) return;
    if (saved[result.matchId]) return tellMine('saved', { handle: me.handle });
    const record = recordFor(result, me.seat, houseAddress(source));
    const problemWith = checkRecord(record);
    if (problemWith) { console.error('[daisy] record problem', problemWith, record); return tellMine('failed'); }
    asking = { record };
    const them = otherPlayer(result, me.seat);
    $('#dz-dialog-title').textContent = `Save this match to @${me.handle}?`;
    $('.dz-dialog-text').textContent = vsBot
      ? `This adds a public record to @${me.handle}'s account (a Daisy match record and nothing else). It names @${them.handle}, the table's bot, which played the other seat from this page. ` +
        "Both players' dice came from this page, so the record shows how the match went, but nobody else can check the dice."
      : `This adds a public record to @${me.handle}'s account (a Daisy match record and nothing else). It mentions @${them.handle}, who played the other seat. ` +
        'Anyone can re-check the dice from it.';
    $('.dz-dialog-record').textContent = JSON.stringify(record, null, 2);
    $('.dz-dialog-details').open = false;
    setDialog('', me.signedIn ? 'Save' : 'Sign in and save', 'Not now');
    dialog.hidden = false;
    $('.dz-dialog-yes').focus();
    tellMine('asking');
  }

  function setDialog(status, yes, no, link = null) {
    const st = $('.dz-dialog-status');
    st.textContent = status;
    if (link) {
      const a = document.createElement('a');
      a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'See the record ↗';
      st.append(' ', a);
    }
    $('.dz-dialog-yes').hidden = !yes;
    if (yes) $('.dz-dialog-yes').textContent = yes;
    $('.dz-dialog-no').textContent = no;
  }

  $('.dz-dialog-yes').addEventListener('click', () => {
    if (!asking) return;
    if (!me.signedIn) return signInAgain(() => doSave());      // from the click: the window may open
    doSave();
  });
  $('.dz-dialog-no').addEventListener('click', closeDialog);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dialog.hidden) closeDialog(); });

  function closeDialog() {
    if (asking && !saved[asking.record.matchId]) tellMine('declined');
    asking = null;
    dialog.hidden = true;
  }

  async function doSave() {
    if (!asking) return;
    const { record } = asking;
    $('.dz-dialog-yes').disabled = true;
    setDialog('Saving…', 'Save', 'Not now');
    tellMine('saving');
    try {
      const { uri } = await auth.putRecord(me.did, { collection: COLLECTION, rkey: record.matchId, record });
      saved[record.matchId] = { uri };
      $('#dz-dialog-title').textContent = 'Match saved';
      setDialog(`Saved to @${me.handle}.`, null, 'Close', uri ? recordLink(uri) : null);
      tellMine('saved', { handle: me.handle });
    } catch (err) {
      if (err instanceof SignInNeeded) {
        me.signedIn = false;
        showAccount();
        setDialog(`@${me.handle}'s sign-in has run out. Sign in again to save; the match is kept until this page closes.`, 'Sign in and save', 'Not now');
        tellMine('signin');
      } else {
        console.error('[daisy] save failed', err);
        setDialog("Couldn't save. Try again.", 'Try again', 'Not now');
        tellMine('failed');
      }
    } finally {
      $('.dz-dialog-yes').disabled = false;
    }
  }

  if (table) {
    $('.dz-open').hidden = true;
    $('.dz-bot').hidden = true;
    $('.dz-bot-text').hidden = true;
    $('.dz-sit').hidden = false;
    const mine = kept(table);
    // A match against the bot lives in the browser that started it (both houses' secrets are there).
    if (params.get('bot') === '1' && !mine.some((k) => k.vsBot)) {
      $('.dz-sit').hidden = true;
      $('.dz-play-text').hidden = true;
      setStatus("This match against the bot is kept in the browser that started it, so it can't be opened here.");
    }
    const tab = tabAccount(table);
    const resume = mine.find((k) => k.me.did === tab);
    if (resume) {
      backAt(resume);
    } else if (mine.length) {
      const box = $('.dz-back');
      box.hidden = false;
      for (const k of mine) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'quiet';
        b.textContent = `Back to your seat as @${k.me.handle}`;
        b.addEventListener('click', () => { $('.dz-back').hidden = true; backAt(k); });
        box.append(b);
      }
    }
  }
  $('.dz-play-text').textContent = table ? "You've been invited to a table." : 'You get a link to send to a friend.';
  // Signed in on this browser before: carry on as that account, no window (it's forgotten if it ran out).
  if (!me) {
    const last = rememberedAccounts()[0];
    if (last && auth && auth.ready() && !authProblem) {
      auth.restore(last.did).then((ok) => { if (ok && !me && !who) who = { did: last.did, handle: last.handle }; showStart(); });
    } else showStart();
  }

  // ---------- the log ----------
  function log(e) {
    const ol = $('.dz-log ol');
    const li = document.createElement('li');
    const t = new Date();
    li.textContent = `${t.toLocaleTimeString()} ${e.dir === 'drop' ? '✕' : e.dir === 'out' ? '→ relay' : e.dir === 'in' ? '← relay' : '·'} ${e.from || ''}${e.to ? ' → ' + e.to : ''} ${e.kind || ''}${e.why ? ' (' + e.why + ')' : ''}${e.note ? ': ' + e.note : ''}`;
    ol.prepend(li);
    while (ol.childElementCount > 200) ol.lastElementChild.remove();
  }

  // For the checks and curious eyes.
  return {
    get me() { return me; }, get other() { return other; }, get snapshot() { return snapshot; }, get phase() { return phase; },
    get result() { return result; }, get hello() { return { ...hello, house: houseSaid }; },
    get mismatch() { return mismatch; }, get source() { return source; }, saved: () => saved, myHouse,
    get lounge() { return lounge; },
    get vsBot() { return vsBot; }, get botSnapshot() { return botSnapshot; },
    blip: () => relay && relay.blip(),
    frames,
  };
}
