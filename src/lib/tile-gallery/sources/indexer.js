// Source: read tiles from your own indexer (planned, on Fly.io).
//
// Not used until CONFIG.source is set to 'indexer'. The indexer is
// expected to listen to Jetstream around the clock and serve:
//
//   GET {indexerUrl}/tiles
//   -> { tiles: [{ did, rkey, cid, value, firstSeen }], authors: [{ did, handle, pds }] }
//
// where `value` is the raw ing.dasl.masl record and `firstSeen` is the
// ISO time the indexer first observed it. Change this file, not the
// rest of the gallery, if the indexer's API ends up shaped differently.

import { getJSON } from '../util.js';
import { normalize } from '../normalize.js';

export async function backfill(config, store, _resolveAuthor, onProgress) {
	if (!config.indexerUrl) throw new Error('CONFIG.indexerUrl is not set');
	onProgress('Loading tiles from the index…');
	const j = await getJSON(`${config.indexerUrl}/tiles`);
	for (const a of j.authors || []) store.authors.set(a.did, { ...a, verified: a.verified ?? null });
	for (const t of j.tiles || []) {
		const tile = normalize(config.collection, t.did, t.rkey, t.cid, t.value, t.firstSeen ? new Date(t.firstSeen) : null);
		if (!config.hidden.has(tile.uri) && !config.hidden.has(tile.did)) store.put(tile);
	}
	return { authors: (j.authors || []).length, failed: 0 };
}
