// way-main.js: starts a way page as a travel page (travel.js), with the site's tile loader. COPY in the site; the
// source is C:\thunderbird-cafe\maze-tiles\site\. Edit it there, then run scripts/copy-to-site.mjs.
//
// One TileMothership for the whole page (as the Rooms lab and Daisy), on the site's loading server
// (src/lib/tile-load-domain.js: a fresh random name per tile, each tile on its own origin). Destination tiles are read
// from their authors' servers and pinned to the version their place names; every file is checked against the record
// before the tile sees it (tile-records.js, the Rooms lab's).
// On this computer only (127.0.0.1): ?loader=… for another loading server (as the Rooms lab), ?sign=… for test
// signposts (way-page.js, W41).
import { TileMothership, Tile } from '@dasl/tile-loader';
import { TILE_LOAD_DOMAIN } from '../lib/tile-load-domain.js';
import { createTileRecords } from './tile-records.js';
import { createTravel } from './travel.js';
import { testSignposts, isHere } from './way-page.js';
import { WAY_PAGES } from './pages.generated.js';

function loadSourceOverride(loc = globalThis.location) {
  if (!isHere(loc)) return null;
  const v = new URLSearchParams(loc.search).get('loader');
  return v && /^https?:\/\/[a-z0-9.-]+(:\d+)?\/\.well-known\/web-tiles\/$/i.test(v) ? v : null;
}

let ship = null;
function mothership() {
  if (!ship) {
    ship = new TileMothership({ loadDomain: TILE_LOAD_DOMAIN });
    const override = loadSourceOverride();
    if (override) ship.getLoadSource = () => override;
    ship.init();
  }
  return ship;
}

const tileHost = {
  render({ uri, manifest, loader }) {
    const tile = new Tile(mothership(), uri, manifest, loader);
    const frame = tile.renderContent(480);
    frame.removeAttribute('style');
    frame.setAttribute('allow', 'autoplay; fullscreen');    // sound may start once you've stepped through (W40)
    frame.setAttribute('referrerpolicy', 'no-referrer');
    return { frame, onLoad: (fn) => tile.addEventListener('load', fn, { once: true }) };
  },
};

const root = document.getElementById('way');
if (root) {
  const page = WAY_PAGES.find((p) => p.signpost === root.dataset.signpost) || { signpost: root.dataset.signpost, from: root.dataset.from };
  const travel = createTravel({ root, page, pages: WAY_PAGES, records: createTileRecords(), tileHost, overrides: testSignposts() });
  window.__way = travel;          // for the console: window.__way.info()
  travel.start();
}
