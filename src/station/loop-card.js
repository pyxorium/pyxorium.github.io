// loop-card.js: the maze card's trip (claude/smallweb-subway-station-plan.md, ST6 and ST13). The travel page's own code
// (src/way/travel.js, createTravel) runs inside the card, unchanged: it already takes the window, history, address and
// title as inputs, so the card hands it small stand-ins and the station's address and tab title stay put. Back works
// inside the card (an in-memory history); the trip's name shows in the card's title bar.
//
// Where it starts: travel.js begins a trip at a signpost. The one that leads into the maze is the forest's slide;
// the card reads it as it is, but for this first leg it leaves out the slide's landing spot, so you arrive at the
// maze's own first entrance (as when the maze is opened anywhere else). Later legs read every signpost unchanged.
// The ▶ RUN click counts as stepping through (W40): the card presses travel.js's "Step through" for you.
import { Tile } from '@dasl/tile-loader';
import { createTileRecords } from '../way/tile-records.js';
import { createTravel } from '../way/travel.js';
import { WAY_PAGES } from '../way/pages.generated.js';
import { LOOP } from './config.js';

// The first lookup of the slide's signpost, without its landing spot (`entrance`) in each destination.
export function firstLegFetch(fetchImpl, rkey = LOOP.rkey) {
  let first = true;
  return async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    const res = await fetchImpl(input, init);
    if (!first || !url.includes('com.atproto.repo.getRecord') || !url.includes('collection=cafe.thunderbird.way.signpost')
      || !url.includes(`rkey=${encodeURIComponent(rkey)}`) || !res.ok) return res;
    first = false;
    const body = await res.json();
    if (body && body.value && Array.isArray(body.value.to)) {
      body.value = { ...body.value, to: body.value.to.map((d) => {
        if (!d || typeof d !== 'object') return d;
        const { entrance, ...rest } = d;
        return rest;
      }) };
    }
    return new Response(JSON.stringify(body), { status: res.status, headers: { 'content-type': 'application/json' } });
  };
}

// A history that lives in the card: pushState/replaceState keep entries, back() steps one back and tells the trip.
export function cardHistory(fire) {
  const entries = [{ state: null }];
  let at = 0;
  return {
    get state() { return entries[at].state; },
    get length() { return entries.length; },
    pushState(state) { entries.splice(at + 1); entries.push({ state }); at = entries.length - 1; },
    replaceState(state) { entries[at] = { state }; },
    back() { if (at > 0) { at -= 1; const s = entries[at].state; setTimeout(() => fire({ state: s }), 0); } },
    forward() { if (at < entries.length - 1) { at += 1; const s = entries[at].state; setTimeout(() => fire({ state: s }), 0); } },
    go(n) { if (n < 0) for (let i = 0; i < -n; i += 1) this.back(); else for (let i = 0; i < n; i += 1) this.forward(); },
  };
}

// Open the loop in `box` (the card's frame area). `ship` is the page's one tile loader. `onPlace(name)` is told the
// name of each place you arrive at. Returns { stop, info }: stop takes the trip down (its frames and listeners).
// `records` and `tileHost` are for the checks (stand-ins); the page uses the real ones.
export function openLoop({ box, ship, onPlace = () => {}, fetchImpl = (...a) => globalThis.fetch(...a), realWin = window,
  records = createTileRecords(), tileHost: givenHost = null }) {
  const listeners = { popstate: new Set() };
  const messageFns = new Set();
  const win = {
    addEventListener(type, fn) {
      if (type === 'message') { messageFns.add(fn); realWin.addEventListener('message', fn); }
      else (listeners[type] || (listeners[type] = new Set())).add(fn);
    },
    removeEventListener(type, fn) {
      if (type === 'message') { messageFns.delete(fn); realWin.removeEventListener('message', fn); }
      else listeners[type]?.delete(fn);
    },
  };
  let stopped = false;
  const hist = cardHistory((e) => { if (!stopped) for (const fn of listeners.popstate) fn(e); });
  const loc = { pathname: realWin.location.pathname, search: '', href: realWin.location.href, hostname: realWin.location.hostname };
  const doc = {
    set title(t) { if (!stopped) onPlace(String(t).replace(/ · thunderbird\.cafe$/, '')); },
    get title() { return ''; },
    body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
  };
  const tileHost = givenHost || {
    render({ uri, manifest, loader }) {
      const tile = new Tile(ship, uri, manifest, loader);
      const frame = tile.renderContent(480);
      frame.removeAttribute('style');
      frame.setAttribute('allow', 'autoplay; fullscreen');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      return { frame, onLoad: (fn) => tile.addEventListener('load', fn, { once: true }) };
    },
  };

  const root = document.createElement('div');
  root.className = 'waybox';
  box.replaceChildren(root);
  const page = WAY_PAGES.find((p) => p.signpost === LOOP.signpost) || { signpost: LOOP.signpost, tile: 'winter-forest', exit: 'slide' };
  const travel = createTravel({ root, page, pages: WAY_PAGES, records, tileHost,
    fetchImpl: firstLegFetch(fetchImpl), win, hist, loc, doc });

  // Press "Step through" as soon as it appears: the RUN click was the visitor stepping through.
  const step = new MutationObserver(() => {
    const b = box.querySelector('.tripscreen .btns button.step:not(:disabled)');
    if (b) { step.disconnect(); b.click(); }
  });
  step.observe(box, { childList: true, subtree: true });
  travel.start();

  function stop() {
    if (stopped) return;
    stopped = true;
    step.disconnect();
    for (const fn of messageFns) realWin.removeEventListener('message', fn);
    messageFns.clear();
    listeners.popstate.clear();
    box.replaceChildren();
  }
  return { stop, info: () => travel.info() };
}
