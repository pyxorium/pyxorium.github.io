// Daisy table: every setting in one place (modelled on src/sevenup/config.js).

// The tile loading server, as the rest of the site (src/lib/tile-load-domain.js): a fresh random name
// per tile, so each tile runs on its own origin.
export const TILE_LOAD_DOMAIN = 'load.tiles.lexicographer.space';

import { PUBLISHED } from './published.generated.js';
import { MEMORY_HOUSE_VERSION } from './tiles.generated.js';

// Where the tiles come from (step 4): the published tiles, pinned (published.generated.js), once they're
// published; until then, or on this computer with ?tiles=memory, the memory copies (tiles.generated.js).
// Either way they run through the real loading server.
export { PUBLISHED };
export const MEMORY_IDS = { house: 'memory://daisy-house', player: 'memory://daisy-player' };
const isHere = (loc) => !!loc && ['localhost', '127.0.0.1'].includes(loc.hostname);
export function tileSource(loc = globalThis.location) {
  if (isHere(loc) && new URLSearchParams(loc.search).get('tiles') === 'memory') return 'memory';
  return PUBLISHED ? 'published' : 'memory';
}
// The house version check (step 4): each page tells the other which house it runs, and the table only
// starts when they match. A published house is named by its record CID; the memory copy by a fingerprint
// of its files (made by copy-to-site.mjs).
export const houseVersion = (source) => (source === 'published' ? PUBLISHED.house.cid : MEMORY_HOUSE_VERSION);
// The house tile's published address ({ uri, cid }), named in every saved record while the table plays the
// published house; the memory copy leaves it out.
export const houseAddress = (source) => (source === 'published' ? PUBLISHED.house : null);

// Public lookups: handle → account, account → its server.
export const HANDLE_RESOLVER = 'https://public.api.bsky.app';
export const PLC_DIRECTORY = 'https://plc.directory';

// Signing in and saving (step 4), and the lounge (step 6). Since step 6 the permissions are asked as Daisy's
// two permission sets (lexicons published from thunderbird.cafe), whose own wording Bluesky's Authorize
// screen shows: "Play Daisy" (the match records only) to sit, and "Daisy lounge" (the lounge record and a
// pass for the relay) only when someone turns mingling on.
export const COLLECTION = 'cafe.thunderbird.daisy.match';
export const LOUNGE_COLLECTION = 'cafe.thunderbird.daisy.lounge';
export const RELAY_AUDIENCE = 'did:web:relay.daisy.thunderbird.cafe#daisy_relay';
export const LOUNGE_ENTER = 'cafe.thunderbird.daisy.lounge.enter';
export const SIT_SCOPE = 'atproto include:cafe.thunderbird.daisy.authPlay';
export const LOUNGE_SCOPE = `${SIT_SCOPE} include:cafe.thunderbird.daisy.authLounge?aud=${RELAY_AUDIENCE.replace('#', '%23')}`;
export const SCOPE = LOUNGE_SCOPE;          // everything this page may ask for (oauth.json says the same)
// A sign-in that can enter the lounge: the server expands the set into these plain permissions.
export const hasLoungeScope = (scope) => /(^|\s)repo:cafe\.thunderbird\.daisy\.lounge(\s|$|\?)/.test(String(scope || ''))
  && String(scope || '').includes(`rpc:${LOUNGE_ENTER}`);
export const PAGE_PATH = '/webtiles/daisy/';
// The sign-in description file (public/webtiles/daisy/oauth.json). On this computer (127.0.0.1) a
// "loopback" sign-in is used instead, built from the page's own address (auth.js).
export const CLIENT_ID = 'https://thunderbird.cafe/webtiles/daisy/oauth.json';
export const SIGNIN_HANDLE_RESOLVER = 'https://bsky.social';     // as the Foundry and Seven-Up
export const ACCOUNTS_KEY = 'daisy-accounts';                    // accounts signed in on this browser
export const recordLink = (uri) => `https://pdsls.dev/${uri}`;

export const TIMES = Object.freeze({
  still: 4000,          // "Still loading…"
  retry: 8000,          // …and Try again
  heartbeat: 3000,      // the page checks in with each tile this often
  misses: 2,            // missed answers in a row before a tile counts as stopped
  tick: 1000,           // the house's clock
  keepFor: 24 * 60 * 60 * 1000,   // this browser keeps a table's state (your seat, your house's seed) a day
});
export const KEEP_PREFIX = 'daisy-table:';     // localStorage, per table and account
export const TAB_PREFIX = 'daisy-tab:';        // sessionStorage: which account this tab sits as

// The away countdown shown while the other player is disconnected (the house's own timers decide).
export const AWAY_MS = { real: 120000, short: 20000 };

// The lounge, on the page's side (the relay keeps the same times, relay lounge.js).
export const LOUNGE_TIMES = Object.freeze({
  noAnswer: 60000,        // "Invite sent" becomes "No answer" after a minute
  hereEvery: 60000,       // tell the relay someone touched the page at most once a minute
  reconnect: [1000, 2000, 4000, 8000, 15000],
});

const isLocal = isHere;

// The relay. The live page uses the real one on Fly.io (step 5: C:\thunderbird-cafe\daisy-relay, app
// thunderbird-daisy-relay). On this computer the stand-in stays the default (node scripts/relay-standin.mjs in
// C:\thunderbird-cafe\daisy-tiles); ?relay=… names another, on this computer only, e.g.
// ?relay=wss://relay.daisy.thunderbird.cafe/ to try the real relay from npm run dev.
export const RELAY_URL = 'wss://relay.daisy.thunderbird.cafe/';
export const LOCAL_RELAY = 'ws://127.0.0.1:8787/';
// The lounge (step 6) lives on the same relay, at /lounge.
export function loungeUrl(loc = globalThis.location) {
  const r = relayUrl(loc);
  return r ? r.replace(/\/?$/, '/lounge') : null;
}
export function relayUrl(loc = globalThis.location) {
  if (!isLocal(loc)) return RELAY_URL;
  const v = new URLSearchParams(loc.search).get('relay');
  return v && /^wss?:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(v) ? v : LOCAL_RELAY;
}

// The short timers (10 s nudge, 30 s turn, 20 s away): only on this computer, with ?timers=short.
// Both pages must ask for them, or the table won't start (the houses compare).
export function timerSet(loc = globalThis.location) {
  return isLocal(loc) && new URLSearchParams(loc.search).get('timers') === 'short' ? 'short' : 'real';
}

// For local testing only: another loading server, as Seven-Up's ?loader=.
export function loadSourceOverride(loc = globalThis.location) {
  if (!isLocal(loc)) return null;
  const v = new URLSearchParams(loc.search).get('loader');
  return v && /^https?:\/\/[a-z0-9.-]+(:\d+)?\/\.well-known\/web-tiles\/$/i.test(v) ? v : null;
}

// The page's own security policy (a <meta> tag on the built page). Connections: lookups, signing in and
// saving over https (the account's own servers), and the relay (wss://relay.daisy.thunderbird.cafe/).
// Pictures: avatars in the handle suggestions, only from Bluesky's picture server.
export function pageCsp(loadDomain = TILE_LOAD_DOMAIN) {
  const base = loadDomain.replace(/^load\./, '');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://cdn.bsky.app",
    "connect-src 'self' https: wss:",
    `frame-src https://${loadDomain} https://*.${base}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

export const newTableId = () => {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return [...b].map((x) => 'abcdefghijkmnopqrstuvwxyz23456789'[x % 33]).join('');
};
