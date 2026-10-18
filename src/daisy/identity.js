// Public account lookups for the Daisy table: a typed handle → its account (DID), and an account → its
// server (PDS). Copied from src/sevenup/identity.js (resolveHandle, cleanHandle, looksLikeHandle, pdsOf).
import { HANDLE_RESOLVER, PLC_DIRECTORY } from './config.js';

export class LookupError extends Error {
  constructor(state, message) { super(message); this.state = state; }
}
export const cleanHandle = (text) => String(text || '').trim().replace(/^@/, '').toLowerCase();
export const looksLikeHandle = (text) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(text);

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

// Step 6: names and pictures for the lounge, from Bluesky's public profiles (handles there are checked by
// Bluesky, so nobody shows up under someone else's handle). Up to 25 a call. did → { handle, name, avatar }.
export async function profilesOf(dids, fetchImpl = fetch) {
  const out = new Map();
  for (let i = 0; i < dids.length; i += 25) {
    const q = new URLSearchParams();
    for (const d of dids.slice(i, i + 25)) q.append('actors', d);
    try {
      const res = await fetchImpl(`${HANDLE_RESOLVER}/xrpc/app.bsky.actor.getProfiles?${q}`);
      if (!res.ok) continue;
      const body = await res.json();
      for (const p of body.profiles || []) {
        if (!p || typeof p.did !== 'string') continue;
        const avatar = typeof p.avatar === 'string' && p.avatar.startsWith('https://cdn.bsky.app/') ? p.avatar : null;
        out.set(p.did, { handle: typeof p.handle === 'string' && p.handle !== 'handle.invalid' ? p.handle : null, name: typeof p.displayName === 'string' ? p.displayName.slice(0, 64) : '', avatar });
      }
    } catch { /* names are a nicety: the list still works with account ids */ }
  }
  return out;
}

// Does the account have its lounge record (the lasting "I mingle")? Read publicly from its own server.
export async function hasLoungeRecord(did, fetchImpl = fetch) {
  const pds = await pdsOf(did, fetchImpl);
  const res = await fetchImpl(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=cafe.thunderbird.daisy.lounge&rkey=self`);
  if (res.ok) return true;
  if (res.status === 400 || res.status === 404) return false;
  throw new LookupError('error', "Couldn't check the lounge record.");
}
