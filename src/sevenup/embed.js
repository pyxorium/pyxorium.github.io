// embed.js: a Seven-Up table embedded in a blog post (src/components/SevenUpDemo.astro). The reader
// sits at seat 1 as "you", the table's bot at seat 2. There's no sign-in and no saving here: pressing
// Save in the tile shows a note pointing to the full table (thunderbird.cafe/webtiles/sevenup/).
//
// It plays the same pinned, published tiles as the full table and reuses its parts: frames.js (the three
// frames, their watchdog and heartbeat), relay.js (the sender stamps and the allowed kinds), the pinned
// loader, and the bot's sprite lookup. Here the blog post's own code is the carrier.
//
// One shared tile loader per page: this table makes its own, so a post that embeds it shouldn't also
// embed WebTile.astro tiles (each loader listens to every message on the page).
//
// mountEmbed(root, deps): deps carries the loader classes, so this file has no package imports and the
// browser checks can run it with stand-ins.
import { EMBED_MARKUP } from './markup.js';
import { createRelay, QUIET_KINDS } from './relay.js';
import { createFrames } from './frames.js';
import { createPinnedLoader } from './pinned-loader.js';
import { fetchSprite } from './identity.js';
import { TILES } from './tiles.generated.js';
import { TILE_LOAD_DOMAIN, PUBLISHED, tileSource, MEMORY_IDS, BOT, TIMES, PAGE_PATH, loadSourceOverride } from './config.js';

const UP = 'tiles-protocol-up-data-payload';
const FULL_TABLE = `https://thunderbird.cafe${PAGE_PATH}`;
// The reader's seat. The player tile puts an @ before any name, so this shows as "@you". Not an
// account: nothing is saved, and the house only needs some text for each seat.
export const READER = Object.freeze({ handle: 'you', did: 'reader:you' });
const SAVE_NOTE = 'Not saved here. Play the full table at thunderbird.cafe/webtiles/sevenup to save.';
const STATUS_TEXT = {
  loading: 'Loading the tile…', slow: 'Still loading…', stuck: 'Still loading…',
  failed: "This tile couldn't be loaded.", stopped: 'This tile stopped answering.',
};

export function mountEmbed(root, { TileMothership, MemoryTileLoader, Tile, fetchImpl = (...a) => fetch(...a) }) {
  root.innerHTML = EMBED_MARKUP(FULL_TABLE);
  const $ = (s, el = root) => el.querySelector(s);
  const seatEl = (n) => $(`.su-seat[data-seat="${n}"]`);
  const seats = { 1: { ...READER }, 2: { handle: BOT.handle, did: BOT.did, bot: true } };
  const hello = { house: false, seat1: false, seat2: false };
  let seated = false;
  let snapshot = null;
  let botSprite = null;
  const source = tileSource();
  root.dataset.tiles = source;

  const frames = createFrames({
    makeMothership() {
      const ship = new TileMothership({ loadDomain: TILE_LOAD_DOMAIN });
      const override = loadSourceOverride();
      if (override) ship.getLoadSource = () => override;      // local testing only (see config.js)
      ship.init();
      if (source === 'published') {
        ship.addLoader(createPinnedLoader({ Tile, pins: [PUBLISHED.house, PUBLISHED.player], fetchImpl }));
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

  const relay = createRelay({ deliver: (target, payload) => frames.send(target, payload), onPage, onLog: log });

  addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d.action !== 'string' || !d.action.startsWith('tiles-protocol-up-')) return;
    const role = frames.roleOf(e.source);
    if (!role) return;                          // not one of this table's tiles
    frames.heard(role);
    if (d.action === UP) relay.fromTile(role, d.payload);
  });

  function onStatus(role, status, extra) {
    if (role === 'house') {
      const note = $('.su-table-note');
      const text = { loading: null, slow: 'Still opening the table…', stuck: 'Still opening the table…',
        failed: "The table couldn't open.", stopped: 'The table stopped answering.' }[status];
      note.hidden = !text;
      if (text) $('p', note).textContent = text;
      $('.su-table-retry').hidden = !['stuck', 'failed', 'stopped'].includes(status);
      if (status === 'loading') hello.house = false;
      if (seated && (status === 'stopped' || status === 'loading')) for (const n of [1, 2]) if (hello[`seat${n}`]) relay.fromPage(`seat${n}`, 'presence', { who: 'house', state: 'gone' });
      return;
    }
    const n = Number(role.slice(4));
    const box = $('.su-status', seatEl(n));
    const text = STATUS_TEXT[status];
    box.hidden = !text;
    if (text) $('p', box).textContent = text;
    $('.su-retry', box).hidden = !['stuck', 'failed', 'stopped'].includes(status);
    if (status === 'stopped' || status === 'loading') {
      hello[role] = false;
      if (seated && hello.house) relay.fromPage('house', 'presence', { seat: n, state: 'gone' });
    }
    if (status === 'ready' && extra.recovered) tileBack(n);
  }

  for (const n of [1, 2]) $('.su-retry', seatEl(n)).addEventListener('click', () => frames.start(`seat${n}`));
  $('.su-table-retry').addEventListener('click', () => frames.start('house'));

  const seatPayload = (n) => ({ seat: n, handle: seats[n].handle, ...(seats[n].bot ? { bot: true } : {}) });
  const seatedPayload = (n) => ({ seat: n, handle: seats[n].handle, did: seats[n].did, ...(seats[n].bot ? { bot: true } : {}) });

  function onPage(from, p) {
    const n = from === 'house' ? 0 : Number(from.slice(4));
    switch (p.kind) {
      case 'hello':
        hello[from] = true;
        if (from === 'house') houseHello(); else tileBack(n);
        sitWhenReady();
        break;
      case 'sprite-request': sendSprite(n); break;
      case 'show-table': showHouse(true); break;
      case 'state': snapshot = p.snapshot; break;
      // The match is over: say straight away that it isn't saved here (the tile still shows Save).
      case 'result':
        root.dataset.result = p.result.matchId;
        if (hello.seat1) relay.fromPage('seat1', 'save-status', { state: 'preview', note: SAVE_NOTE });
        $('.su-embed-save').hidden = false;
        break;
      case 'save-request':
        relay.fromPage(`seat${n}`, 'save-status', { state: 'preview', note: SAVE_NOTE });
        $('.su-embed-save').hidden = false;
        break;
    }
  }

  // Both seats are taken as soon as all three tiles have said hello.
  function sitWhenReady() {
    if (seated || !hello.house || !hello.seat1 || !hello.seat2) return;
    seated = true;
    for (const n of [1, 2]) {
      relay.fromPage(`seat${n}`, 'seat', seatPayload(n));
      relay.fromPage('house', 'seated', seatedPayload(n));
    }
  }

  // A restarted house gets the match back (from the latest snapshot, kept in memory only).
  function houseHello() {
    if (!seated) return;
    for (const n of [1, 2]) if (hello[`seat${n}`]) relay.fromPage(`seat${n}`, 'presence', { who: 'house', state: 'back' });
    if (snapshot && snapshot.phase !== 'seating') relay.fromPage('house', 'resume', { snapshot });
    else for (const n of [1, 2]) relay.fromPage('house', 'seated', seatedPayload(n));
  }

  // A restarted or recovered player tile: tell it its seat, and have the house resend the table.
  function tileBack(n) {
    if (!seated) return;
    relay.fromPage(`seat${n}`, 'seat', seatPayload(n));
    if (!hello.house) return;
    if (snapshot && snapshot.waitingFor === n - 1) relay.fromPage('house', 'presence', { seat: n, state: 'back' });
    else relay.fromPage('house', 'sync', {});
  }

  // The bot's rpg.actor sprite (public). The reader has none.
  async function sendSprite(n) {
    if (!seats[n].bot) return relay.fromPage(`seat${n}`, 'sprite-status', { state: 'no-sprite' });
    botSprite ||= fetchSprite(BOT.did, fetchImpl).catch((err) => { console.warn('[sevenup] sprite', err); return null; });
    const sprite = await botSprite;
    if (!sprite) return relay.fromPage(`seat${n}`, 'sprite-status', { state: 'no-sprite' });
    relay.fromPage(`seat${n}`, 'sprite', {
      handle: BOT.handle, image: sprite.blob,
      frameWidth: sprite.frameWidth, frameHeight: sprite.frameHeight, sheetWidth: sprite.sheetWidth, sheetHeight: sprite.sheetHeight,
    });
  }

  // The house, full size (tap the corner picture in either seat).
  function showHouse(show) {
    $('.su-house').hidden = !show;
    if (show) $('.su-house-close').focus();
  }
  $('.su-house-close').addEventListener('click', () => showHouse(false));
  $('.su-house').addEventListener('click', (e) => { if (e.target === $('.su-house')) showHouse(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('.su-house').hidden) showHouse(false); });

  // The message log, as on the full table.
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

  // Start the three tiles once the table comes near the screen (not for readers who never scroll to it).
  let started = false;
  function start() {
    if (started) return;
    started = true;
    frames.start('house');
    frames.start('seat1');
    frames.start('seat2');
  }
  if ('IntersectionObserver' in globalThis) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
    }, { rootMargin: '600px 0px' });
    io.observe(root);
  } else start();

  return { seats, hello, frames, relay, snapshot: () => snapshot };
}
