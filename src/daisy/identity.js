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
