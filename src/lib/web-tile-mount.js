// Embedded Web Tiles on the blog (WebTile.astro): one shared tile loader for
// the whole page, and a watchdog on each tile.
//
// Why: each tile's files come through a small service worker on one of the
// loading server's names (load.tiles.thunderbird.cafe hands out tile1 to tile5).
// Sometimes a tile never gets going (two tiles landing on the same name, or the
// worker being stopped by the browser); see claude/tile-loading-findings.md in
// the Foundry project. Starting the tile afresh gets it a new frame, a new name
// and a new worker, and the files it already downloaded are kept by
// at-tile-loader.js, so a fresh start is quick.
//
// The watchdog: "Loading tile…" until the tile's own page has been handed
// over, "Still loading…" after 4 s, and a Try again button after 8 s that
// starts the tile afresh. Nothing restarts on its own.
//
// Usage (WebTile.astro):
//   const mount = createTileMounter({ loadDomain, Mothership: TileMothership, loaders: [new ATTileLoaderWithDidWeb()] });
//   document.querySelectorAll('.web-tile-mount').forEach(mount);
// Each mount element carries data-uri and data-height, and holds a status box:
//   <div class="web-tile-status"><span class="web-tile-loading">Loading tile…</span>
//   <button class="web-tile-retry" type="button" hidden>Try again</button></div>

export const TILE_LOAD_TIMES = Object.freeze({ still: 4000, retry: 8000 });

export function createTileMounter({ loadDomain, Mothership, loaders = [], times = TILE_LOAD_TIMES }) {
  // One loader ("mothership") for every tile on the page: each one listens to
  // every message on the page, so several would trip over each other's tiles.
  let mothership = null;
  function ship() {
    if (!mothership) {
      mothership = new Mothership({ loadDomain });
      mothership.init();
      for (const l of loaders) mothership.addLoader(l);
    }
    return mothership;
  }

  return function mount(el) {
    const uri = el.dataset.uri;
    const height = Number(el.dataset.height) || 500;
    if (!uri) return;
    const status = el.querySelector('.web-tile-status');
    const words = el.querySelector('.web-tile-loading');
    const retry = el.querySelector('.web-tile-retry');
    let attempt = 0;
    let timers = [];
    let frame = null;

    function say(text, { button = false } = {}) {
      if (!status) return;
      status.hidden = !text;
      if (words) words.textContent = text || '';
      if (retry) retry.hidden = !button;
    }
    function clearTimers() {
      timers.forEach(clearTimeout);
      timers = [];
    }

    async function start() {
      const mine = ++attempt;
      clearTimers();
      if (frame) { frame.remove(); frame = null; }
      el.classList.remove('is-ready');
      say('Loading tile…');
      timers = [
        setTimeout(() => { if (mine === attempt) say('Still loading…'); }, times.still),
        setTimeout(() => { if (mine === attempt) say('Still loading…', { button: true }); }, times.retry),
      ];
      let tile;
      try {
        tile = await ship().loadTile(uri);
      } catch (err) {
        console.error('Tile load failed:', err);
        tile = null;
      }
      if (mine !== attempt) return;
      if (!tile) {
        clearTimers();
        say('Could not load this tile.', { button: true });
        return;
      }
      // The tile is under way once its own page ("/") has been handed over:
      // from then on the tile shows itself.
      const resolve = tile.resolvePath.bind(tile);
      tile.resolvePath = async (path) => {
        const res = await resolve(path);
        if (mine === attempt && (path === '/' || path === '/index.html')) {
          clearTimers();
          if (res && res.ok) {
            say('');
            el.classList.add('is-ready');
          } else {
            say('Could not load this tile.', { button: true });
          }
        }
        return res;
      };
      frame = tile.renderContent(height);
      el.appendChild(frame);
    }

    if (retry) retry.addEventListener('click', () => start());
    start();
  };
}
