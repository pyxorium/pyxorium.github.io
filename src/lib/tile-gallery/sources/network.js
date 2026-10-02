// Source: read tiles directly from the network, in the visitor's browser.
// 1. Ask the relay which accounts have ing.dasl.masl records.
// 2. Resolve each account's PDS.
// 3. Page through that PDS's records for the collection.

import { getJSON, pool } from '../util.js';
import { normalize } from '../normalize.js';

async function listAuthors(config) {
	const dids = [];
	let cursor;
	do {
		const u = new URL(`${config.relay}/xrpc/com.atproto.sync.listReposByCollection`);
		u.searchParams.set('collection', config.collection);
		u.searchParams.set('limit', '1000');
		if (cursor) u.searchParams.set('cursor', cursor);
		const j = await getJSON(u);
		for (const r of j.repos || []) dids.push(r.did);
		cursor = j.cursor;
	} while (cursor);
	return dids;
}

async function loadAuthorTiles(config, store, resolveAuthor, did) {
	const a = await resolveAuthor(did);
	if (!a.pds) throw new Error('no PDS in DID document');
	let cursor;
	do {
		const u = new URL(`${a.pds}/xrpc/com.atproto.repo.listRecords`);
		u.searchParams.set('repo', did);
		u.searchParams.set('collection', config.collection);
		u.searchParams.set('limit', '100');
		if (cursor) u.searchParams.set('cursor', cursor);
		const j = await getJSON(u);
		const records = j.records || [];
		for (const rec of records) {
			const rkey = rec.uri.split('/').pop();
			const tile = normalize(config.collection, did, rkey, rec.cid, rec.value, null);
			if (!config.hidden.has(tile.uri)) store.put(tile);
		}
		cursor = records.length ? j.cursor : null;
	} while (cursor);
}

export async function backfill(config, store, resolveAuthor, onProgress) {
	onProgress('Finding authors…');
	const dids = (await listAuthors(config)).filter((d) => !config.hidden.has(d));
	let done = 0;
	let failed = 0;
	await pool(dids, config.concurrency, async (did) => {
		try {
			await loadAuthorTiles(config, store, resolveAuthor, did);
		} catch {
			failed++;
		}
		done++;
		onProgress(`Loading tiles… ${done} of ${dids.length} authors`);
	});
	return { authors: dids.length, failed };
}
