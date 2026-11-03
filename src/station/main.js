// main.js: Thunderbird Café Station (/webtiles/station/). Plan: claude/smallweb-subway-station-plan.md (ST5, ST13).
//
// One tile loader for the whole page, shared by every card and the maze card's trip (each loader listens to every
// message on the page, so two would trip over each other's tiles). The cards themselves are in the page's HTML
// (src/pages/webtiles/station/index.astro); this script brings them to life:
//   - LIVE cards start when they come within about a screen of view, and keep running;
//   - ▶ RUN cards start when clicked, and go back to their banner when about two screens out of view (ST13, option C);
//   - the maze card runs the loop to Winter Forest and back inside the card (loop-card.js);
//   - steam rises from the mug cursor (not for people who ask for less motion, nor on touch screens).
import { TileMothership } from '@dasl/tile-loader';
import { ATTileLoaderWithDidWeb } from '../lib/at-tile-loader.js';
import { createTileMounter } from '../lib/web-tile-mount.js';
import { TILE_LOAD_DOMAIN } from '../lib/tile-load-domain.js';
import { openLoop } from './loop-card.js';
import { startSteam } from './steam.js';

export const NEAR = '100% 0px';      // LIVE cards start within about one screen
export const FAR = '200% 0px';       // RUN cards stop beyond about two screens

export function startStation({ doc = document, Mothership = TileMothership, loaders = [new ATTileLoaderWithDidWeb()],
  loadDomain = TILE_LOAD_DOMAIN, Observer = globalThis.IntersectionObserver, openLoopImpl = openLoop } = {}) {
  const ship = new Mothership({ loadDomain });
  ship.init();
  for (const l of loaders) ship.addLoader(l);
  const mount = createTileMounter({ loadDomain, Mothership, mothership: ship });

  const cards = [...doc.querySelectorAll('.tile[data-uri]')];
  const state = new Map();       // card → { kind, control, running, loop }

  function setName(card, text) {
    const n = card.querySelector('.titlebar .name');
    if (n) n.textContent = text;
  }

  function run(card) {
    const s = state.get(card);
    if (!s || s.running) return;
    s.running = true;
    card.classList.add('on');
    if (s.kind === 'loop') {
      const box = card.querySelector('.loop');
      s.loop = openLoopImpl({ box, ship, onPlace: (name) => setName(card, name) });
    } else {
      s.control.start();
    }
  }
  function halt(card) {
    const s = state.get(card);
    if (!s || !s.running) return;
    s.running = false;
    if (s.loop) { s.loop.stop(); s.loop = null; setName(card, card.dataset.name); }
    if (s.control) s.control.stop();
    card.classList.remove('on');
  }

  for (const card of cards) {
    const kind = card.dataset.kind;          // 'live' | 'run' | 'loop'
    const el = card.querySelector('.web-tile-mount');
    const control = kind === 'loop' ? null : mount(el, { autostart: false });
    state.set(card, { kind, control, running: false, loop: null });
    const btn = card.querySelector('.runbtn');
    if (btn) btn.addEventListener('click', () => run(card));
  }

  if (Observer) {
    const near = new Observer((entries) => {
      for (const e of entries) if (e.isIntersecting) { run(e.target); near.unobserve(e.target); }
    }, { rootMargin: NEAR });
    const far = new Observer((entries) => {
      for (const e of entries) if (!e.isIntersecting) halt(e.target);
    }, { rootMargin: FAR });
    for (const card of cards) {
      if (card.dataset.kind === 'live') near.observe(card);
      else far.observe(card);
    }
  } else {
    for (const card of cards) if (card.dataset.kind === 'live') run(card);
  }

  return { ship, run, halt, state: (card) => ({ ...state.get(card), loop: !!state.get(card)?.loop }), loopInfo: (card) => state.get(card)?.loop?.info() };
}

if (typeof document !== 'undefined' && document.getElementById('station') && !globalThis.__stationTest) {
  window.__station = startStation();
  startSteam();
}
