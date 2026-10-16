// Public account lookups for the Seven-Up table (no sign-in): a typed handle → its account (DID), and
// an account's rpg.actor sprite. The sprite lookup is copied from src/lib/cosmic-junkyard/sprite-host.js
// (fetchSpriteForHandle, which isn't exported), starting from the account instead of the handle.
import { HANDLE_RESOLVER, PLC_DIRECTORY } from './config.js';

const MAX_SPRITE_BYTES = 1024 * 1024;   // real rpg.actor sheets are around 12 KB

export class LookupError extends Error {
  constructor(state, message) { super(message); this.state = state; }
}

export function cleanHandle(text) {
  return String(text || '').trim().replace(/^@/, '').toLowerCase();
}
export function looksLikeHandle(text) {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(text);
}

export async function resolveHandle(handle, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(`${HANDLE_RESOLVER}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
  } catch {
    throw new LookupError('error', `Couldn't look up @${handle}. Check the connection and try again.`);
  }
  if (!res.ok) throw new LookupError('not-found', `Couldn't find @${handle}.`);
  const data = await res.json().catch(() => ({}));
  if (typeof data.did !== 'string' || !data.did.startsWith('did:')) throw new LookupError('not-found', `Couldn't find @${handle}.`);
  return data.did;
}

const pdsCache = new Map();
export async function pdsOf(did, fetchImpl = fetch) {
  if (pdsCache.has(did)) return pdsCache.get(did);
  let docUrl;
  if (did.startsWith('did:plc:')) docUrl = `${PLC_DIRECTORY}/${encodeURIComponent(did)}`;
  else if (did.startsWith('did:web:')) docUrl = `https://${did.slice('did:web:'.length)}/.well-known/did.json`;
  else throw new LookupError('error', 'That account uses an identity type this table doesn\'t support.');
  const res = await fetchImpl(docUrl);
  if (!res.ok) throw new LookupError('error', "Couldn't look up that account's server.");
  const doc = await res.json();
  const pds = (doc.service || []).find((s) => s.type === 'AtprotoPersonalDataServer');
  if (!pds || typeof pds.serviceEndpoint !== 'string' || !pds.serviceEndpoint.startsWith('https://')) {
    throw new LookupError('error', "Couldn't look up that account's server.");
  }
  const url = pds.serviceEndpoint.replace(/\/+$/, '');
  pdsCache.set(did, url);
  return url;
}

// Returns { blob, frameWidth, frameHeight, sheetWidth, sheetHeight }, or null when the account has
// no sprite. Throws LookupError when something went wrong.
export async function fetchSprite(did, fetchImpl = fetch) {
  const pds = await pdsOf(did, fetchImpl);
  const recordRes = await fetchImpl(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=actor.rpg.sprite&rkey=self`);
  if (!recordRes.ok) return null;
  const v = (await recordRes.json()).value || {};
  const cid = v.spriteSheet && v.spriteSheet.ref && v.spriteSheet.ref.$link;
  if (!cid) return null;
  const blobRes = await fetchImpl(`${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`);
  if (!blobRes.ok) throw new LookupError('error', 'Found the sprite record, but its image wouldn\'t download.');
  const blob = await blobRes.blob();
  if (blob.type && !blob.type.startsWith('image/')) throw new LookupError('error', "That sprite isn't an image.");
  if (blob.size > MAX_SPRITE_BYTES) throw new LookupError('error', 'That sprite image is too large.');
  return { blob, frameWidth: v.frameWidth || 48, frameHeight: v.frameHeight || 48, sheetWidth: v.width || 144, sheetHeight: v.height || 192 };
}
