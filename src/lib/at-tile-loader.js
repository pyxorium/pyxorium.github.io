// AT Protocol tile loader with did:web support.
//
// A drop-in replacement for ATTileLoader from '@dasl/tile-loader/at'.
// The official loader only looks up did:plc accounts (its source notes
// "we should add did:web"). This one looks up both did:plc and did:web,
// and otherwise works the same way: it reads the tile's ing.dasl.masl
// record, then serves each of the tile's files from the author's PDS.
//
// Everything that keeps tiles safe (the sandboxed frames, the loading
// server, the network shut-off) is still the official @dasl/tile-loader.
// This file only decides where to fetch a tile's record and files from.
//
// When the official loader supports did:web, switch back to ATTileLoader
// and delete this file.
//
// Usage:
//   import { TileMothership } from '@dasl/tile-loader';
//   import { ATTileLoaderWithDidWeb } from '../lib/at-tile-loader.js';
//   mothership.addLoader(new ATTileLoaderWithDidWeb());

import { Tile } from '@dasl/tile-loader';

const COLLECTION = 'ing.dasl.masl';

// Same 404 shape and header list as @dasl/tile-loader's lib/masl.js,
// which the package doesn't export.
const NOT_FOUND = { ok: false, status: 404, statusText: 'Not found' };
const MASL_HEADERS = [
	'content-disposition',
	'content-encoding',
	'content-language',
	'content-security-policy',
	'content-type',
	'link',
	'permissions-policy',
	'referrer-policy',
	'service-worker-allowed',
	'sourcemap',
	'speculation-rules',
	'supports-loading-mode',
	'x-content-type-options',
];

function maslResponse(masl, body) {
	if (!body) return NOT_FOUND;
	const headers = {};
	for (const k of MASL_HEADERS) {
		if (typeof masl[k] !== 'undefined') headers[k] = masl[k];
	}
	if (typeof body === 'string') body = new TextEncoder().encode(body);
	return { ok: true, status: 200, statusText: 'Ok', headers, body };
}

// ---- identity: DID -> PDS ----

// did:web for atproto is hostname-only (a port may be encoded as %3A).
const DID_WEB_RE = /^did:web:([a-z0-9.-]+(?:%3A[0-9]+)?)$/i;
const DID_PLC_RE = /^did:plc:[a-z2-7]{24}$/;

function didDocumentUrl(did) {
	if (DID_PLC_RE.test(did)) return `https://plc.directory/${did}`;
	const m = did.match(DID_WEB_RE);
	if (m) return `https://${m[1].replace(/%3A/i, ':')}/.well-known/did.json`;
	return null;
}

export function canLoadDid(did) {
	return didDocumentUrl(did) !== null;
}

const pdsCache = new Map(); // did -> Promise<string | false>

function did2pds(did) {
	if (pdsCache.has(did)) return pdsCache.get(did);
	const p = (async () => {
		const url = didDocumentUrl(did);
		if (!url) return false;
		const res = await fetch(url);
		if (!res.ok) return false;
		const doc = await res.json();
		const svc = (doc.service || []).find((s) => s.id === '#atproto_pds' || s.id === `${did}#atproto_pds`);
		return typeof svc?.serviceEndpoint === 'string' ? svc.serviceEndpoint : false;
	})().catch(() => false);
	pdsCache.set(did, p);
	return p;
}

async function fetchFromPDS(did, method, params) {
	const pds = await did2pds(did);
	if (!pds) return undefined;
	const url = new URL(pds);
	url.pathname = `/xrpc/${method}`;
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	return fetch(url.toString());
}

async function getRecord(repo, collection, rkey) {
	const res = await fetchFromPDS(repo, 'com.atproto.repo.getRecord', { repo, collection, rkey });
	if (!res || !res.ok) return false;
	return res.json();
}

async function getBlob(did, cid) {
	const res = await fetchFromPDS(did, 'com.atproto.sync.getBlob', { did, cid });
	if (!res || !res.ok) return false;
	return res.arrayBuffer();
}

// ---- loaders ----

// Serves one tile's files, by path, from the author's PDS.
class ATPathLoader {
	#did;
	#manifest;
	constructor(did, manifest) {
		this.#did = did;
		this.#manifest = manifest;
	}
	async resolvePath(path) {
		const entry = this.#manifest?.resources?.[path];
		if (!entry?.src) return NOT_FOUND;
		const src = entry.src;
		const cid = '$link' in src ? src.$link : src.ref?.$link;
		if (!cid) return NOT_FOUND;
		const data = await getBlob(this.#did, cid);
		if (!data) return NOT_FOUND;
		return maslResponse(entry, data);
	}
}

// at://<did>/ing.dasl.masl/<rkey>
export class ATTileLoaderWithDidWeb {
	async load(url, mothership) {
		if (!/^at:\/\//.test(url)) return false;
		const [repo, collection, rkey] = url.replace(/^at:\/\//, '').split('/');
		if (collection !== COLLECTION || !rkey) return undefined;
		if (!canLoadDid(repo)) return false;
		const res = await getRecord(repo, collection, rkey);
		if (!res) return false;
		const manifest = res.value?.tile;
		if (!manifest) return false;
		return new Tile(mothership, url, manifest, new ATPathLoader(repo, manifest));
	}
}
