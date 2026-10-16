// pinned-loader.js: loads the published Seven-Up tiles, but only the exact versions the table was set up
// with (config.js / published.generated.js: each tile's address and record CID).
//
// Like the site's src/lib/at-tile-loader.js it reads the tile's ing.dasl.masl record and serves its files
// from the author's PDS; in addition it refuses the tile if its record isn't the pinned one (someone
// republished or changed it), and checks every file against its content address before handing it over.
// So a later change to a tile can't quietly change the game: updating is a deliberate step
// (publish, then copy-to-site.mjs).
import { pdsOf } from './identity.js';

const COLLECTION = 'ing.dasl.masl';
const NOT_FOUND = { ok: false, status: 404, statusText: 'Not found' };
const MASL_HEADERS = ['content-disposition', 'content-encoding', 'content-language', 'content-security-policy', 'content-type',
  'link', 'permissions-policy', 'referrer-policy', 'service-worker-allowed', 'sourcemap', 'speculation-rules',
  'supports-loading-mode', 'x-content-type-options'];

function maslResponse(entry, body) {
  const headers = {};
  for (const k of MASL_HEADERS) if (typeof entry[k] !== 'undefined') headers[k] = entry[k];
  return { ok: true, status: 200, statusText: 'Ok', headers, body };
}

// A file's raw-codec CIDv1 ("bafkrei…"), as a PDS gives a blob (same as the Foundry's cid.js).
export async function rawCid(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const all = new Uint8Array(4 + digest.length);
  all.set([0x01, 0x55, 0x12, 0x20], 0);
  all.set(digest, 4);
  const A = 'abcdefghijklmnopqrstuvwxyz234567';
  let out = 'b', buffer = 0, bits = 0;
  for (const byte of all) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5) { out += A[(buffer >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += A[(buffer << (5 - bits)) & 31];
  return out;
}

export class TileChanged extends Error {}

export function createPinnedLoader({ Tile, pins, fetchImpl = (...a) => fetch(...a), onRefused = () => {} }) {
  const files = new Map();                     // cid → Promise<ArrayBuffer | null>, kept while the page is open
  async function blob(did, cid) {
    if (!files.has(cid)) {
      files.set(cid, (async () => {
        const pds = await pdsOf(did, fetchImpl);
        const res = await fetchImpl(`${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`);
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        return (await rawCid(new Uint8Array(buf))) === cid ? buf : null;      // not the pinned bytes: refuse
      })().catch(() => null));
    }
    const buf = await files.get(cid);
    if (!buf) { files.delete(cid); return null; }
    return buf.slice(0);                       // a fresh copy each time (the loader may hand it on)
  }

  return {
    async load(url, mothership) {
      const pin = pins.find((p) => p.uri === url);
      if (!pin) return false;                  // only the table's own tiles
      const [did, collection, rkey] = url.replace(/^at:\/\//, '').split('/');
      if (collection !== COLLECTION) return false;
      const pds = await pdsOf(did, fetchImpl);
      const res = await fetchImpl(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${COLLECTION}&rkey=${encodeURIComponent(rkey)}`);
      if (!res.ok) return false;
      const body = await res.json();
      if (body.cid !== pin.cid || !body.value || !body.value.tile) {
        onRefused(url, body.cid);
        throw new TileChanged(`${url} has changed since the table was set up (record ${body.cid}, expected ${pin.cid}).`);
      }
      const manifest = body.value.tile;
      return new Tile(mothership, url, manifest, {
        async resolvePath(path) {
          const entry = manifest.resources && manifest.resources[path];
          const src = entry && entry.src;
          const cid = src && (src.$link || (src.ref && src.ref.$link));
          if (!cid) return NOT_FOUND;
          const data = await blob(did, cid);
          return data ? maslResponse(entry, data) : NOT_FOUND;
        },
      });
    },
  };
}
