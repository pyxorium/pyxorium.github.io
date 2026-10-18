// Entry point for the Daisy page (src/pages/webtiles/daisy/index.astro). The styles, daisy.css, are
// imported by the page itself.
import { TileMothership, Tile } from '@dasl/tile-loader';
import { MemoryTileLoader } from '@dasl/tile-loader/memory';
import { BrowserOAuthClient, LoginContinuedInParentWindowError } from '@atproto/oauth-client-browser';
import { createAuth } from './auth.js';
import { mountTable } from './table.js';

async function start() {
  const root = document.getElementById('daisy');
  if (!root) return;
  const auth = createAuth({ BrowserOAuthClient, LoginContinuedInParentWindowError });
  const started = await auth.start();
  if (started.finishedInWindow) {
    // This is the small sign-in window: the table page has the result now.
    root.innerHTML = '<p class="dz-window-done">Signed in. You can close this window.</p>';
  } else if (!started.moving) {
    window.__daisy = mountTable(root, { TileMothership, MemoryTileLoader, Tile, auth, authProblem: started.error || null });
  }
}
start();
