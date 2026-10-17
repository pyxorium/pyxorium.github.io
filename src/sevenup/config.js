// Seven-Up table: every setting in one place, so the page can move later (its own repo or address).

// The tile loading server. Same one as the rest of the site (src/lib/tile-load-domain.js): a fresh
// random name per tile, so each tile runs on its own origin. Kept here as well so this folder stands
// on its own.
export const TILE_LOAD_DOMAIN = 'load.tiles.lexicographer.space';

import { PUBLISHED } from './published.generated.js';

// Where the tiles come from: the published tiles, pinned (published.generated.js), once they're
// published; until then, or on this computer with ?tiles=memory, the memory copies (tiles.generated.js).
// Either way they run through the real loading server.
export { PUBLISHED };
export const MEMORY_IDS = { house: 'memory://sevenup-house', player: 'memory://sevenup-player' };
export function tileSource(loc = globalThis.location) {
  const local = loc && ['localhost', '127.0.0.1'].includes(loc.hostname);
  if (local && new URLSearchParams(loc.search).get('tiles') === 'memory') return 'memory';
  return PUBLISHED ? 'published' : 'memory';
}

// Seats are open to any atproto account (since Oct 17 2026; before that, only the owner's two demo
// accounts). One account per seat, and nobody but the bot takes the bot's account.

// Public lookups (no sign-in): handle → account, account → its server, its rpg.actor sprite.
export const HANDLE_RESOLVER = 'https://public.api.bsky.app';
export const PLC_DIRECTORY = 'https://plc.directory';

export const TIMES = Object.freeze({
  still: 4000,          // "Still loading…"
  retry: 8000,          // …and Try again
  heartbeat: 3000,      // the page checks in with each tile this often
  misses: 2,            // missed answers in a row before a tile counts as stopped
  resumeFor: 60 * 60 * 1000,   // a match can be resumed for an hour after the page closed
});
export const RESUME_KEY = 'sevenup-resume';

// The house tile's published address ({ uri, cid }), named in every saved record (while the table
// plays the published house). Until it's published, records leave it out.
export const HOUSE_ADDRESS = PUBLISHED ? PUBLISHED.house : null;

// The page's own security policy (a <meta> tag on the live page; GitHub Pages can't send headers).
// Tiles run in frames from the loading server; signing in talks to the account's own servers, so
// connections go to any https address. No outside scripts, no inline scripts.
export function pageCsp(loadDomain = TILE_LOAD_DOMAIN) {
  const base = loadDomain.replace(/^load\./, '');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://cdn.bsky.app",          // avatars in the handle suggestions
    "connect-src 'self' https:",
    `frame-src https://${loadDomain} https://*.${base}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

// The table's bot: plays a seat for someone on their own. It never signs in and keeps no record.
export const BOT = { did: 'did:plc:hd2efebmfhpqcusfya4lguce', handle: 'dicesprite.thunderbird.cafe' };

// Saving. Signing in asks only for this one kind of record: nothing else in the account.
export const COLLECTION = 'cafe.thunderbird.sevenup.match';
export const SCOPE = `atproto repo:${COLLECTION}`;
export const PAGE_PATH = '/webtiles/sevenup/';
// The sign-in description file (public/webtiles/sevenup/oauth.json). On this computer (127.0.0.1)
// a "loopback" sign-in is used instead, built from the page's own address (auth.js).
export const CLIENT_ID = 'https://thunderbird.cafe/webtiles/sevenup/oauth.json';
export const SIGNIN_HANDLE_RESOLVER = 'https://bsky.social';     // as the Foundry
export const ACCOUNTS_KEY = 'sevenup-accounts';                  // accounts signed in on this browser
export const recordLink = (uri) => `https://pdsls.dev/${uri}`;

// For local testing only: on localhost a different loading server can be named with ?loader=…
// (the browser checks run a copy of the loading server). Ignored everywhere else.
export function loadSourceOverride(loc = globalThis.location) {
  if (!loc || !['localhost', '127.0.0.1'].includes(loc.hostname)) return null;
  const v = new URLSearchParams(loc.search).get('loader');
  return v && /^https?:\/\/[a-z0-9.-]+(:\d+)?\/\.well-known\/web-tiles\/$/i.test(v) ? v : null;
}
