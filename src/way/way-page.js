// way-page.js: reading where a tile's exit leads, and the page's plain views, for the way pages, e.g.
// https://thunderbird.cafe/way/maze/obelisk (claude/escher-maze-ways-plan.md, M19, M25). Since Winter Forest's step 3
// (claude/winter-forest-step3-plan.md, W39 to W45, and claude/winter-forest-plan.md, W17, W26) the page is a travel
// page: travel.js takes you there and carries you on. This file reads the exit's signpost (a
// cafe.thunderbird.way.signpost record) straight from its account, which a page can do and a tile can't:
//   empty (or missing)  "This doesn't lead anywhere yet."
//   one destination     travel.js takes you there
//   several             their cards side by side ("pick a door"), each with "Go this way"
// A destination is a place (cafe.thunderbird.way.place: a tile's address and exact version) or a tile record.
// The cards are also what's shown when the page can't run tiles (no tile loader: the checks of this file alone).
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
  const entrance = typeof dest.entrance === 'string' && /^[a-z0-9-]{1,64}$/.test(dest.entrance) ? dest.entrance : null;
  let tileUri = null, pinned = null, placeName = '', placeUri = null;
  if (dest.place) {
    placeUri = dest.place;
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
    place: placeUri,
    tile: tileUri,
    pinned,
    entrance,
    name: clip(t.name, 100) || placeName || 'A tile',
    description: clip(t.description, 600),
    by: rec.handle,
    icon: iconCid ? `${rec.pds}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did: at.did, cid: iconCid })}` : null,
    raku: `https://raku.lexicographer.space/#t=${encodeURIComponent(tileUri)}&a=0`,
    viewer: rec.handle ? `https://lexicographer.space/@${rec.handle}/${at.rkey}` : null,
    changed: !!(pinned && rec.cid && pinned !== rec.cid),
  };
}

// Test signposts (W41): on this computer only (127.0.0.1 or localhost), the address may say what a signpost
// should lead to, as if it were filled, e.g. ?sign=maze.obelisk:winter-forest@thunderbird.cafe/lamppost
//   <signpost's name>:<place's name>/<entrance>            the place in the same account as the signpost
//   <signpost's name>:<place's name>@<account>/<entrance>  the place in another account (0.4.0: the maze is
//                                                           pyxorium.com's, the forest thunderbird.cafe's); the
//                                                           account a did, or one of the two handles in TEST_ACCOUNTS
// Several destinations joined with commas; nothing after the colon means empty (dormant); several signposts, several
// sign= in the address. Everything else stays real. The live site ignores it. Returns Map(name → to[]).
export const TEST_ACCOUNTS = Object.freeze({ 'thunderbird.cafe': 'did:plc:6vxjigxrqizmbo56gojxico3', 'pyxorium.com': 'did:plc:rqbqpaaluty5v47jwciowpik' });
export const isHere = (loc) => !!loc && ['127.0.0.1', 'localhost'].includes(loc.hostname);
export function testSignposts(loc = globalThis.location) {
  const out = new Map();
  if (!isHere(loc)) return out;
  for (const v of new URLSearchParams(loc.search).getAll('sign')) {
    const m = /^([A-Za-z0-9._~-]{1,200}):(.*)$/.exec(v);
    if (!m) continue;
    const to = [];
    for (const d of m[2].split(/[,\s]+/).filter(Boolean)) {      // (a "+" in an address reads as a space)
      const dm = /^([A-Za-z0-9._~-]{1,200})(?:@([A-Za-z0-9._:%-]{1,200}))?(?:\/([a-z0-9-]{1,64}))?$/.exec(d);
      if (!dm) continue;
      const did = dm[2] ? (dm[2].startsWith('did:') ? dm[2] : TEST_ACCOUNTS[dm[2]]) : null;
      if (dm[2] && !did) continue;
      to.push({ placeName: dm[1], ...(did ? { did } : {}), ...(dm[3] ? { entrance: dm[3] } : {}) });
    }
    out.set(m[1], to);
  }
  return out;
}
// The test destinations for this signpost, as a signpost's `to` would say them, or null (use the real one).
function overrideFor(at, overrides) {
  if (!overrides || !overrides.has(at.rkey)) return null;
  return overrides.get(at.rkey).map((d) => ({ place: `at://${d.did || at.did}/${PLACE}/${d.placeName}`, ...(d.entrance ? { entrance: d.entrance } : {}) }));
}

// Is this signpost filled? 'open' | 'dormant' (also when it can't be read: the tile then says so if walked into).
export async function signpostState({ signpost, fetchImpl = fetch, overrides = null, cache = new Map() }) {
  const at = parseAtUri(signpost);
  if (!at || at.collection !== SIGNPOST) return 'dormant';
  const o = overrideFor(at, overrides);
  if (o) return o.length ? 'open' : 'dormant';
  try {
    const rec = await getRecord(fetchImpl, at, cache);
    return Array.isArray(rec.value && rec.value.to) && rec.value.to.length ? 'open' : 'dormant';
  } catch { return 'dormant'; }
}

// Where a signpost leads: { state: 'dormant' | 'open' | 'error', note, doors }.
export async function lookUpWay({ signpost, fetchImpl = fetch, overrides = null }) {
  const at = parseAtUri(signpost);
  if (!at || at.collection !== SIGNPOST) return { state: 'error', message: 'This page names no signpost.' };
  const cache = new Map();
  let rec;
  const o = overrideFor(at, overrides);
  if (o) rec = { value: { to: o, note: '' } };
  else {
    try { rec = await getRecord(fetchImpl, at, cache); } catch (err) {
      if (err.error === 'RecordNotFound' || err.status === 404) return { state: 'dormant', note: '', doors: [] };
      return { state: 'error', message: 'The signpost couldn\'t be read just now. Try again in a moment.' };
    }
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
export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v);
  for (const k of kids) if (k !== null && k !== undefined && k !== '') e.append(k);
  return e;
}

// A door's card. With onGo (the travel page), its main button takes you through; without, links to Raku.
function card(door, onGo) {
  if (door.broken) return el('li', { class: 'door broken' }, door.label ? el('p', { class: 'label' }, door.label) : null, el('p', {}, door.broken));
  let go = null;
  if (onGo) {
    go = el('button', { type: 'button', class: 'go' }, 'Go this way');
    go.addEventListener('click', () => onGo(door));
  }
  const links = el('p', { class: 'links' },
    go || el('a', { href: door.raku, class: 'go' }, 'Open in Raku'),
    !onGo && door.viewer ? el('a', { href: door.viewer }, 'on lexicographer.space') : null);
  return el('li', { class: 'door' },
    door.label ? el('p', { class: 'label' }, door.label) : null,
    el('div', { class: 'head' },
      door.icon ? el('img', { src: door.icon, alt: '', width: '64', height: '64', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
      el('div', {}, el('h2', {}, door.name), door.by ? el('p', { class: 'by' }, `by @${door.by}`) : null)),
    door.description ? el('p', { class: 'desc' }, door.description) : null,
    door.changed ? el('p', { class: 'small' }, 'This tile has changed since its place was last pointed at it.') : null,
    links);
}

// view: { state: 'loading' | 'error' | 'dormant' | 'open', … }. onGo(door): the travel page's "Go this way";
// onCancel: a "Stay here" under the doors (when picking a door on the way out of a place).
export function render(root, view, { from = 'this way', onGo = null, onCancel = null } = {}) {
  root.replaceChildren();
  root.append(el('p', { class: 'from' }, `You came through ${from}.`));
  if (view.state === 'loading') { root.append(el('p', { class: 'wait' }, 'Looking at the signpost…')); return; }
  if (view.state === 'error') { root.append(el('h1', {}, view.title || 'Can\'t see the way'), el('p', {}, view.message)); return; }
  if (view.state === 'dormant') {
    root.append(el('h1', {}, "This doesn't lead anywhere yet."));
    if (view.note) root.append(el('p', { class: 'note' }, view.note));
    root.append(el('p', { class: 'small' }, 'Come back another time: when it leads somewhere, this page will say where.'));
    return;
  }
  root.append(el('h1', {}, view.doors.length > 1 ? 'Pick a door' : 'This way leads to'));
  if (view.note) root.append(el('p', { class: 'note' }, view.note));
  root.append(el('ul', { class: view.doors.length > 1 ? 'doors several' : 'doors' }, ...view.doors.map((d) => card(d, onGo))));
  if (onCancel) {
    const stay = el('button', { type: 'button', class: 'stay' }, 'Stay here');
    stay.addEventListener('click', onCancel);
    root.append(el('p', { class: 'links' }, stay));
  }
}

// Without a tile loader (start(root) alone): the plain page of cards, as before the travel page.
export async function start(root = document.getElementById('way'), fetchImpl = fetch) {
  if (!root) return;
  const from = root.dataset.from || 'this way';
  render(root, { state: 'loading' }, { from });
  render(root, await lookUpWay({ signpost: root.dataset.signpost, fetchImpl, overrides: testSignposts() }), { from });
}
