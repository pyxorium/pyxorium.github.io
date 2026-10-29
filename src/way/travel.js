// travel.js: the way pages as travel pages (claude/winter-forest-plan.md, W17 and W26; claude/winter-forest-step3-plan.md,
// W39 to W41). The page at /way/<tile>/<exit> (e.g. /way/maze/obelisk) reads that exit's signpost and takes you where
// it leads: it loads the destination tile with the site's tile loader, says hello back, tells it which of its own
// exits lead somewhere, and sends "arrive at …". When the tile says "I left by …", the page reads that exit's
// signpost, loads the next place and sends its arrival, so the trip carries on in this one tab.
//
// What the traveller sees:
//   - the tile filling the window under a slim bar (on phones the bar tucks away until tapped): the place's name and
//     whose place it is, Back (when there's a place before this one in the tab), "Open in Raku" (open places only:
//     not for a ways-only place like Winter Forest, which shows only a postcard when opened on its own);
//   - between places, a brief screen in the colour of the portal you went through, with the next place's name;
//   - on first opening (a new tab, a reload, a shared link: W40) that screen waits for "Step through", so the
//     browser lets the tile's sound start and the page can hand the keys to the tile;
//   - several destinations: "Pick a door" (with "Stay here" on the way out of a place);
//   - a trip that fails: "The way is blocked." and you're back where you left (at that portal, or the place's first
//     entrance if that portal is an exit only);
//   - the tab's title follows you.
// The address follows the last way taken (W39): each leg changes it to the exit just used (after the forest's slide,
// /way/winter-forest/slide/) and adds a history entry, so a reload or a shared link replays that leg, and the
// browser's Back steps back one leg, like the bar's Back (landing at the portal you left by).
//
// The messages (the maze's src/ways.js and the forest's forest/src/ways.js, M23):
//   tile → page  { action: "tiles-protocol-up-way-payload",   payload: { v: 1, kind: "hello" | "leave", … } }
//   page → tile  { action: "tiles-protocol-down-way-payload", payload: { v: 1, kind: "status" | "arrive", … } }
// They come from the tile loader's frame (the loader's shuttle passes any tiles-protocol-up-*/down-* message along),
// so the page knows which tile spoke by the frame's window. The tile never says who is travelling.
//
// No DOM work happens before start(); everything outside (the loader, the records, fetch, history, timers) is passed
// in, so the checks can run it with stand-ins.
import { lookUpWay, signpostState, parseAtUri, render, el, PLACE, SIGNPOST } from './way-page.js';

export const UP = 'tiles-protocol-up-way-payload';
export const DOWN = 'tiles-protocol-down-way-payload';
export const V = 1;
export const TIMES = Object.freeze({
  helloMs: 30_000,          // a tile that hasn't said hello by then (or loaded, for a tile without ways) didn't open
  slowMs: 4000,             // then "Still on the way…" on the screen
  plainMs: 1200,            // a tile without ways: shown this long after the loader says it's running
  revealMs: 450,            // after "arrive", the screen stays this long (the tile plays its own arrival under it)…
  fadeMs: 400,              // …then fades out over this
  noteMs: 3200,             // "The way is blocked." stays this long
  tuckMs: 6000,             // on phones, the bar tucks away again after this
});
// The portals' fade colours (the tiles' own: the forest's THROUGH_COLOUR and the ride's blue; the maze's Great Hall;
// the glow behind the Lantern room's door, M28).
export const COLOURS = Object.freeze({
  'maze/obelisk': '#4260b0',
  'maze/second-door': '#8498cc',
  'winter-forest/wardrobe': '#ffffff',
  'winter-forest/tree-door': '#c98a3e',
  'winter-forest/arch': '#cfe2ee',
  'winter-forest/slide': '#4260b0',
});
export const NIGHT = '#10131c';
const LIGHT = new Set(['#ffffff', '#cfe2ee']);
const MAX_EXITS = 24;
const ID = /^[a-z0-9-]{1,64}$/;

/** A tile's /ways.json, checked (v 1): { tile, place, entry, exits: [{ id, signpost }], entrances: [id] } or null. */
export function readWays(json) {
  if (!json || typeof json !== 'object' || json.v !== 1 || typeof json.tile !== 'string' || !ID.test(json.tile)) return null;
  const exits = (Array.isArray(json.exits) ? json.exits : []).slice(0, MAX_EXITS)
    .filter((e) => e && ID.test(e.id) && parseAtUri(e.signpost)?.collection === SIGNPOST)
    .map((e) => ({ id: e.id, signpost: e.signpost }));
  const entrances = (Array.isArray(json.entrances) ? json.entrances : []).slice(0, MAX_EXITS).map((e) => e && e.id).filter((id) => ID.test(id || ''));
  const place = parseAtUri(json.place)?.collection === PLACE ? json.place : null;
  return { tile: json.tile, place, entry: json.entry === 'ways-only' ? 'ways-only' : 'open', exits, entrances };
}

/** Which entrance to arrive at: the one asked for if the place has it, else its first (none: null). */
export const entranceFor = (ways, asked) => (ways.entrances.includes(asked) ? asked : ways.entrances[0] || null);

/** The way page for an exit, if the site has one for that place: "/way/<tile>/<exit>/". */
export function pathFor(pages, ways, exit) {
  const p = pages.find((x) => x.tile === ways.tile && x.exit === exit && (!x.place || !ways.place || x.place === ways.place));
  return p ? `/way/${p.tile}/${p.exit}/` : null;
}

export function createTravel({ root, page, pages = [], records, tileHost, fetchImpl = (...a) => globalThis.fetch(...a), overrides = null,
  win = globalThis.window, hist = globalThis.history, loc = globalThis.location, doc = globalThis.document,
  setTimer = (f, ms) => setTimeout(f, ms), times = TIMES }) {
  const wait = (ms) => new Promise((r) => setTimer(r, ms));
  const recordCache = new Map();          // tile uri → Promise<record>
  const legs = [];                        // leg number → what it was (as in its history entry's state)
  let here = null;                        // the visit you're in: { door, ways, statuses, frame, entrance, leg }
  let leg = 0;
  let busy = false;                       // a leg is underway: tiles' "leave" and the bar wait
  let pendingPop = null;
  const visits = new Set();               // every frame on the page (the one you're in, and one being loaded)

  // ---- the page's parts ----------------------------------------------------------------------------------------------
  const trip = el('div', { class: 'trip', hidden: '' });
  const where = el('span', { class: 'where' });
  const testMark = el('span', { class: 'testmark', hidden: '', title: 'This computer only: some signposts come from the address (?sign=…)' }, 'test signposts');
  const backBtn = el('button', { type: 'button', class: 'back', hidden: '' }, 'Back');
  const rakuLink = el('a', { class: 'raku', hidden: '', target: '_blank', rel: 'noopener' }, 'Open in Raku');
  const bar = el('header', { class: 'tripbar' }, where, testMark, el('span', { class: 'gap' }), backBtn, rakuLink);
  const tab = el('button', { type: 'button', class: 'triptab', 'aria-label': 'Show the bar' });
  const stage = el('div', { class: 'tripstage' });
  const screenName = el('p', { class: 'name' });
  const screenBy = el('p', { class: 'by' });
  const screenMsg = el('p', { class: 'msg', role: 'status' });
  const screenBtns = el('p', { class: 'btns' });
  const screenDoors = el('div', { class: 'doorsbox', hidden: '' });
  const screen = el('div', { class: 'tripscreen', hidden: '' }, el('div', { class: 'inner' }, screenName, screenBy, screenMsg, screenBtns, screenDoors));
  const noteEl = el('p', { class: 'tripnote', role: 'status' });
  trip.append(bar, tab, stage, screen, noteEl);
  if (overrides && overrides.size) testMark.hidden = false;

  let tuckTimer = 0;
  const showBar = () => { trip.classList.add('barout'); clearTimeout(tuckTimer); tuckTimer = setTimer(() => trip.classList.remove('barout'), times.tuckMs); };
  tab.addEventListener('click', showBar);
  backBtn.addEventListener('click', () => { if (!busy && leg > 0) hist.back(); });

  let noteTimer = 0;
  function note(text) { noteEl.textContent = text; noteEl.classList.add('show'); clearTimeout(noteTimer); noteTimer = setTimer(() => noteEl.classList.remove('show'), times.noteMs); }

  function showScreen(colour, { name = '', by = '', msg = '' } = {}) {
    screen.hidden = false;
    screen.classList.remove('going');
    screen.style.background = colour;
    screen.classList.toggle('light', LIGHT.has(colour));
    screenName.textContent = name;
    screenBy.textContent = by ? `by @${by}` : '';
    screenMsg.textContent = msg;
    screenBtns.replaceChildren();
    screenDoors.hidden = true; screenDoors.replaceChildren();
  }
  function screenButton(text, onClick, { cls = '' } = {}) {
    const b = el('button', { type: 'button', class: cls }, text);
    b.addEventListener('click', onClick);
    screenBtns.append(b);
    return b;
  }
  async function hideScreen() {
    await wait(times.revealMs);
    screen.classList.add('going');
    await wait(times.fadeMs);
    if (screen.classList.contains('going')) { screen.hidden = true; screen.classList.remove('going'); }
  }

  // ---- talking with tiles ----------------------------------------------------------------------------------------------
  const post = (visit, payload) => { const w = visit.frame && visit.frame.contentWindow; if (w) w.postMessage({ action: DOWN, payload: { v: V, ...payload } }, '*'); };
  const sendStatus = (visit) => post(visit, { kind: 'status', exits: visit.statuses });
  win.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.action !== UP || !d.payload || d.payload.v !== V) return;
    const visit = [...visits].find((v) => v.frame && v.frame.contentWindow === e.source);
    if (!visit || !visit.ways) return;
    const p = d.payload;
    if (p.kind === 'hello') {
      sendStatus(visit);
      if (!visit.helloed) { visit.helloed = true; visit.onHello?.(); }
    } else if (p.kind === 'leave') {
      if (visit !== here || busy || typeof p.exit !== 'string') return;
      const exit = visit.ways.exits.find((x) => x.id === p.exit);
      if (exit) leaveBy(exit);
    }
  });

  // ---- opening a place ---------------------------------------------------------------------------------------------------
  function readRecord(uri) {
    if (!recordCache.has(uri)) recordCache.set(uri, records.read(uri).then((r) => { if (!r.ok) recordCache.delete(uri); return r; }));
    return recordCache.get(uri);
  }
  // A door → a visit with its frame loading (behind the screen) and ready() resolving when the tile can be shown.
  async function openVisit(door) {
    const rec = await readRecord(door.tile);
    if (!rec.ok) throw new Error(rec.why);
    if (door.pinned && rec.cid !== door.pinned) throw new Error(`the tile changed since its place was pointed at it (record ${rec.cid}, place ${door.pinned})`);
    const loader = records.pathLoader({ pds: rec.pds, did: rec.did, manifest: rec.manifest });
    let ways = null;
    if (rec.manifest.resources['/ways.json']) {
      const res = await loader.resolvePath('/ways.json');
      if (res.ok) { try { ways = readWays(JSON.parse(new TextDecoder().decode(res.body))); } catch { ways = null; } }
      if (!ways) throw new Error('its /ways.json couldn’t be read');
    }
    const statuses = {};
    if (ways) {
      const cache = new Map();
      await Promise.all(ways.exits.map(async (x) => { statuses[x.id] = await signpostState({ signpost: x.signpost, fetchImpl, overrides, cache }); }));
    }
    const visit = { door, ways, statuses, rec, helloed: false, onHello: null };
    const shown = tileHost.render({ uri: rec.uri, manifest: rec.manifest, loader });
    visit.frame = shown.frame;
    visit.frame.classList.add('tripframe', 'loading');
    visit.frame.setAttribute('title', door.name || rec.name);
    visits.add(visit);
    visit.ready = new Promise((resolve, reject) => {
      const t = setTimer(() => reject(new Error('the tile didn’t open in time')), times.helloMs);
      if (ways) visit.onHello = () => { clearTimeout(t); resolve(); };
      else shown.onLoad(() => setTimer(() => { clearTimeout(t); resolve(); }, times.plainMs));
    });
    stage.append(visit.frame);
    return visit;
  }
  // The keys to the tile (W40): its own window is inside the loader's frame (the shuttle's one frame). A page may call
  // focus() on another site's window, so the tile gets the keys without a click.
  function focusTile(visit) {
    try { visit.frame.focus(); } catch { /* fine */ }
    try { const inner = visit.frame.contentWindow && visit.frame.contentWindow.frames[0]; if (inner) inner.focus(); } catch { /* fine */ }
  }
  function drop(visit) {
    if (!visit) return;
    visits.delete(visit);
    visit.frame?.remove();
  }

  // ---- a leg: going to a door (first opening, or on from where you are, or back) ---------------------------------------
  // how: { first, activated, colour, entrance, from: { tile, exit, place } | null, push, backTo }
  async function go(door, how) {
    busy = true;
    const colour = how.colour || NIGHT;
    showScreen(colour, { name: door.name, by: door.by });
    trip.hidden = false; root.hidden = true;
    doc.body.classList.add('travelling');
    const slow = setTimer(() => { if (busy && !screenBtns.querySelector('.step')) screenMsg.textContent = 'Still on the way…'; }, times.slowMs);
    // First opening: "Step through" waits for the click while the tile loads (W40).
    let stepped = how.activated ? Promise.resolve() : null;
    if (!stepped) {
      stepped = new Promise((resolve) => {
        const b = screenButton('Step through', () => { b.disabled = true; b.textContent = 'Opening…'; resolve(); }, { cls: 'step' });
        try { b.focus(); } catch { /* fine */ }
      });
    }
    let visit = null;
    try {
      visit = await openVisit(door);
      await visit.ready;
      await stepped;
    } catch (err) {
      clearTimeout(slow);
      console.warn('[way] the way is blocked:', err && err.message);
      drop(visit);
      busy = false;
      return blockedOn(how);
    }
    clearTimeout(slow);
    // In: send the arrival, swap the frames, the bar, the title, the address.
    const entrance = visit.ways ? entranceFor(visit.ways, how.entrance) : null;
    visit.entrance = entrance;
    if (visit.ways) { sendStatus(visit); if (entrance) post(visit, { kind: 'arrive', entrance }); }
    const before = here;
    here = visit;
    visit.frame.classList.remove('loading');
    if (before && before !== visit) drop(before);
    paintBar();
    doc.title = `${door.name} · thunderbird.cafe`;
    record(visit, how);
    focusTile(visit);
    screenBtns.replaceChildren(); screenMsg.textContent = '';
    busy = false;
    await hideScreen();
    if (!busy) focusTile(visit);
    if (pendingPop) { const p = pendingPop; pendingPop = null; onPop(p); }
    return visit;
  }

  // The trip failed. On the way out of a place: back where you left. On first opening: say so, and offer to try again.
  function blockedOn(how) {
    if (here && how.from) return returnTo(here, how.from.exit, { blocked: true });
    if (here) { screen.hidden = true; note('The way is blocked.'); return null; }
    screenBtns.replaceChildren();
    screenMsg.textContent = 'The way is blocked.';
    screenButton('Try again', () => { recordCache.clear(); go(how.door, { ...how, activated: true }); });
    return null;
  }
  // Back at the place you're in, at the portal you left by (or its first entrance if that's an exit only).
  function returnTo(visit, exitId, { blocked = false } = {}) {
    const entrance = entranceFor(visit.ways, exitId);
    if (entrance) post(visit, { kind: 'arrive', entrance });
    busy = false;
    screen.hidden = true;
    if (blocked) note('The way is blocked.');
    focusTile(visit);
    return visit;
  }

  // ---- leaving a place by an exit -------------------------------------------------------------------------------------
  async function leaveBy(exit) {
    busy = true;
    const from = { tile: here.ways.tile, exit: exit.id, place: here.ways.place, name: here.door.name };
    const colour = COLOURS[`${from.tile}/${from.exit}`] || NIGHT;
    showScreen(colour, { msg: '' });
    const view = await lookUpWay({ signpost: exit.signpost, fetchImpl, overrides }).catch(() => ({ state: 'error' }));
    const doors = view.state === 'open' ? view.doors.filter((d) => !d.broken) : [];
    if (!doors.length) return returnTo(here, exit.id, { blocked: true });
    const onward = (door) => go(door, { activated: true, colour, entrance: door.entrance, from, push: true, door });
    if (view.doors.length === 1) return onward(doors[0]);
    // Pick a door: the doors on the screen, and "Stay here".
    screenDoors.hidden = false;
    render(screenDoors, view, { from: `${from.name}'s ${from.exit}`, onGo: (d) => { screenDoors.hidden = true; onward(d); }, onCancel: () => returnTo(here, exit.id) });
    return null;
  }

  // ---- the bar ---------------------------------------------------------------------------------------------------------
  function paintBar() {
    const d = here.door;
    where.replaceChildren(el('b', {}, d.name), d.by ? el('span', { class: 'by' }, ` by @${d.by}`) : '');
    tab.textContent = d.name;
    backBtn.hidden = leg === 0;
    const open = !here.ways || here.ways.entry !== 'ways-only';
    rakuLink.hidden = !open;
    if (open) rakuLink.href = `https://raku.lexicographer.space/#t=${encodeURIComponent(here.rec.uri)}&a=0`;
  }

  // ---- the address and history (W39) ----------------------------------------------------------------------------------
  const keep = (door) => ({ tile: door.tile, pinned: door.pinned || null, place: door.place || null, name: door.name, by: door.by || null, entrance: door.entrance || null });
  function record(visit, how) {
    if (how.pop !== undefined) { leg = how.pop; legs[leg] = { ...(legs[leg] || {}), door: keep(visit.door), entrance: visit.entrance }; paintBar(); return; }
    const state = { way: 1, door: keep(visit.door), entrance: visit.entrance, from: how.from || null };
    if (how.push) {
      leg += 1;
      const path = (how.from && pathFor(pages, { tile: how.from.tile, place: how.from.place }, how.from.exit)) || loc.pathname;
      hist.pushState({ ...state, leg }, '', path + loc.search);
    } else {
      hist.replaceState({ ...state, leg }, '', loc.href);
    }
    legs[leg] = state;
    paintBar();
  }
  // The browser's Back or Forward. Back: to that place, at the portal you left it by (the next leg's exit). Forward:
  // to that place as you arrived there.
  async function onPop(st) {
    if (!st || st.way !== 1 || typeof st.leg !== 'number' || !st.door) return;
    if (busy) { pendingPop = st; return; }
    const back = st.leg < leg;
    const after = back ? legs[st.leg + 1] : st;
    const exit = after && after.from ? after.from.exit : null;
    const colour = (after && after.from && COLOURS[`${after.from.tile}/${after.from.exit}`]) || NIGHT;
    legs[st.leg] = { ...st };
    await go(st.door, { activated: true, colour, entrance: back ? exit : st.entrance, pop: st.leg, from: null, door: st.door });
  }
  win.addEventListener('popstate', (e) => onPop(e.state));

  // ---- starting -----------------------------------------------------------------------------------------------------------
  async function start() {
    root.after(trip);
    const from = page.from || 'this way';
    render(root, { state: 'loading' }, { from });
    const view = await lookUpWay({ signpost: page.signpost, fetchImpl, overrides });
    if (hist.state && hist.state.way === 1 && typeof hist.state.leg === 'number') leg = hist.state.leg;     // a reload: keep counting
    const first = { tile: page.tile, exit: page.exit, place: page.place || null };
    const colour = COLOURS[`${page.tile}/${page.exit}`] || NIGHT;
    const doors = view.state === 'open' ? view.doors : [];
    const usable = doors.filter((d) => !d.broken);
    if (view.state !== 'open' || !usable.length) { render(root, view.state === 'open' ? { state: 'error', title: 'The way is blocked.', message: 'Where this leads couldn’t be opened just now. Try again in a moment.' } : view, { from }); return null; }
    if (doors.length === 1) return go(usable[0], { first: true, activated: false, colour, entrance: usable[0].entrance, from: first, door: usable[0] });
    // Several: pick a door on the page; the click counts as stepping through.
    render(root, view, { from, onGo: (d) => go(d, { first: true, activated: true, colour, entrance: d.entrance, from: first, door: d }) });
    return null;
  }

  // For the checks (test/browser/check_travel.mjs): what the page knows right now.
  const info = () => ({ leg, busy, place: here && here.door.name, entrance: here && here.entrance, statuses: here && here.statuses, frames: visits.size,
    screen: !screen.hidden, screenText: screen.hidden ? '' : screen.innerText, note: noteEl.classList.contains('show') ? noteEl.textContent : '',
    back: !backBtn.hidden, raku: !rakuLink.hidden, title: doc.title, path: loc.pathname, test: !testMark.hidden });
  return { start, info, go, frameOf: () => here && here.frame };
}
