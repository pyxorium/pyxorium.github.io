// way-page.js: the fallback page for a tile's exit, e.g. https://thunderbird.cafe/way/maze/obelisk
// (claude/escher-maze-ways-plan.md, M19, M25). A tile opened where no host carries travellers (a plain viewer)
// offers this address in a new tab. The page reads the exit's signpost (a cafe.thunderbird.way.signpost record)
// straight from its account, which a page can do and a tile can't, and says where the exit leads:
//   empty (or missing)  "This doesn't lead anywhere yet."
//   one destination     its card, with links to open it in Raku and on lexicographer.space
//   several             their cards side by side ("pick a door")
// A destination is a place (cafe.thunderbird.way.place: a tile's address and exact version) or a tile record.
//
// The source is C:\thunderbird-cafe\maze-tiles\site\ (tested there); the site has a COPY made by
// scripts/copy-to-site.mjs. Edit it there.

export const PLACE = 'cafe.thunderbird.way.place';
export const SIGNPOST = 'cafe.thunderbird.way.signpost';
export const TILE = 'ing.dasl.masl';
const MAX_DOORS = 12;
const AT_URI = /^at:\/\/(did:(?:plc:[a-z2-7]{24}|web:[a-zA-Z0-9.:%-]+))\/([a-zA-Z0-9.-]+)\/([A-Za-z0-9._:~-]{1,512})$/;

export function parseAtUri(uri) {
  const m = AT_URI.exec(typeof uri === 'string' ? uri : '');
  return m ? { did: m[1], collection: m[2], rkey: m[3] } : null;
}

const clip = (s, n) => (typeof s === 'string' ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : '');

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) { const err = new Error((body && (body.message || body.error)) || `Request failed (${res.status})`); err.status = res.status; err.error = body && body.error; throw err; }
  return body;
}

// An account's server and handle, from its DID document (plc.directory, or did:web's own address).
export async function accountOf(fetchImpl, did, cache = new Map()) {
  if (cache.has(did)) return cache.get(did);
  const p = (async () => {
    const url = did.startsWith('did:plc:') ? `https://plc.directory/${did}` : `https://${decodeURIComponent(did.slice(8)).replace(/:/g, '/')}/.well-known/did.json`;
    const doc = await getJson(fetchImpl, url);
    const svc = (doc.service || []).find((s) => s.type === 'AtprotoPersonalDataServer' || String(s.id).endsWith('#atproto_pds'));
    if (!svc || !/^https:\/\//.test(svc.serviceEndpoint)) throw new Error(`No server for ${did}.`);
    const aka = (doc.alsoKnownAs || []).find((a) => a.startsWith('at://'));
    return { pds: String(svc.serviceEndpoint).replace(/\/+$/, ''), handle: aka ? aka.slice(5) : null };
  })();
  cache.set(did, p);
  return p;
}

async function getRecord(fetchImpl, at, cache) {
  const { pds, handle } = await accountOf(fetchImpl, at.did, cache);
  const q = new URLSearchParams({ repo: at.did, collection: at.collection, rkey: at.rkey });
  const r = await getJson(fetchImpl, `${pds}/xrpc/com.atproto.repo.getRecord?${q}`);
  return { ...r, pds, handle };
}

// One destination → a door: the tile it opens, as a card.
async function doorOf(fetchImpl, dest, cache) {
  const label = clip(dest.label, 100);
  let tileUri = null, pinned = null, placeName = '';
  if (dest.place) {
    const at = parseAtUri(dest.place);
    if (!at || at.collection !== PLACE) return { label, broken: 'This way points at something that isn\'t a place.' };
    const place = await getRecord(fetchImpl, at, cache);
    tileUri = place.value && place.value.tile;
    pinned = place.value && place.value.cid;
    placeName = clip(place.value && place.value.name, 100);
  } else if (dest.tile) tileUri = dest.tile;
  const at = parseAtUri(tileUri);
  if (!at || at.collection !== TILE) return { label, broken: 'This way points at something that isn\'t a tile.' };
  const rec = await getRecord(fetchImpl, at, cache);
  const t = (rec.value && rec.value.tile) || {};
  const icon = t.icons && t.icons[0] && t.resources && t.resources[t.icons[0].src];
  const iconCid = icon && icon.src && icon.src.ref && icon.src.ref.$link;
  return {
    label,
    name: clip(t.name, 100) || placeName || 'A tile',
    description: clip(t.description, 600),
    by: rec.handle,
    icon: iconCid ? `${rec.pds}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did: at.did, cid: iconCid })}` : null,
    raku: `https://raku.lexicographer.space/#t=${encodeURIComponent(tileUri)}&a=0`,
    viewer: rec.handle ? `https://lexicographer.space/@${rec.handle}/${at.rkey}` : null,
    changed: !!(pinned && rec.cid && pinned !== rec.cid),
  };
}

// Where a signpost leads: { state: 'dormant' | 'open' | 'error', note, doors }.
export async function lookUpWay({ signpost, fetchImpl = fetch }) {
  const at = parseAtUri(signpost);
  if (!at || at.collection !== SIGNPOST) return { state: 'error', message: 'This page names no signpost.' };
  const cache = new Map();
  let rec;
  try { rec = await getRecord(fetchImpl, at, cache); } catch (err) {
    if (err.error === 'RecordNotFound' || err.status === 404) return { state: 'dormant', note: '', doors: [] };
    return { state: 'error', message: 'The signpost couldn\'t be read just now. Try again in a moment.' };
  }
  const v = rec.value || {};
  const note = clip(v.note, 100);
  const to = Array.isArray(v.to) ? v.to.slice(0, MAX_DOORS) : [];
  if (!to.length) return { state: 'dormant', note, doors: [] };
  const doors = await Promise.all(to.map((d) => doorOf(fetchImpl, d && typeof d === 'object' ? d : {}, cache)
    .catch(() => ({ label: clip(d && d.label, 100), broken: 'This way couldn\'t be looked up just now.' }))));
  return { state: 'open', note, doors };
}

// ---- drawing (DOM only; no innerHTML) ----------------------------------------------------------------------------
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v);
  for (const k of kids) if (k !== null && k !== undefined && k !== '') e.append(k);
  return e;
}

function card(door) {
  if (door.broken) return el('li', { class: 'door broken' }, door.label ? el('p', { class: 'label' }, door.label) : null, el('p', {}, door.broken));
  const links = el('p', { class: 'links' },
    el('a', { href: door.raku, class: 'go' }, 'Open in Raku'),
    door.viewer ? el('a', { href: door.viewer }, 'on lexicographer.space') : null);
  return el('li', { class: 'door' },
    door.label ? el('p', { class: 'label' }, door.label) : null,
    el('div', { class: 'head' },
      door.icon ? el('img', { src: door.icon, alt: '', width: '64', height: '64', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
      el('div', {}, el('h2', {}, door.name), door.by ? el('p', { class: 'by' }, `by @${door.by}`) : null)),
    door.description ? el('p', { class: 'desc' }, door.description) : null,
    door.changed ? el('p', { class: 'small' }, 'This tile has changed since its place was last pointed at it.') : null,
    links);
}

export function render(root, view, { from = 'this way' } = {}) {
  root.replaceChildren();
  root.append(el('p', { class: 'from' }, `You came through ${from}.`));
  if (view.state === 'loading') { root.append(el('p', { class: 'wait' }, 'Looking at the signpost…')); return; }
  if (view.state === 'error') { root.append(el('h1', {}, 'Can\'t see the way'), el('p', {}, view.message)); return; }
  if (view.state === 'dormant') {
    root.append(el('h1', {}, "This doesn't lead anywhere yet."));
    if (view.note) root.append(el('p', { class: 'note' }, view.note));
    root.append(el('p', { class: 'small' }, 'Come back another time: when it leads somewhere, this page will say where.'));
    return;
  }
  root.append(el('h1', {}, view.doors.length > 1 ? 'Pick a door' : 'This way leads to'));
  if (view.note) root.append(el('p', { class: 'note' }, view.note));
  root.append(el('ul', { class: view.doors.length > 1 ? 'doors several' : 'doors' }, ...view.doors.map(card)));
}

export async function start(root = document.getElementById('way'), fetchImpl = fetch) {
  if (!root) return;
  const from = root.dataset.from || 'this way';
  render(root, { state: 'loading' }, { from });
  render(root, await lookUpWay({ signpost: root.dataset.signpost, fetchImpl }), { from });
}
