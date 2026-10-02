// Live updates from Jetstream, filtered to the tile collection.
// Creates and updates are added to the store; deletes remove the card.

import { normalize } from './normalize.js';

export function connectLive(config, store, resolveAuthor, onStatus) {
	let ws;
	let lastTimeUs = null;
	let retry = 1000;

	function connect() {
		const u = new URL(config.jetstream);
		u.searchParams.set('wantedCollections', config.collection);
		// On reconnect, replay a few seconds so nothing is missed.
		if (lastTimeUs) u.searchParams.set('cursor', String(lastTimeUs - 5_000_000));

		ws = new WebSocket(u);
		ws.onopen = () => {
			retry = 1000;
			onStatus(true);
		};
		ws.onclose = () => {
			onStatus(false);
			setTimeout(connect, retry);
			retry = Math.min(retry * 2, 30000);
		};
		ws.onerror = () => ws.close();
		ws.onmessage = async (e) => {
			let ev;
			try {
				ev = JSON.parse(e.data);
			} catch {
				return;
			}
			if (ev.time_us) lastTimeUs = ev.time_us;
			if (ev.kind !== 'commit' || ev.commit?.collection !== config.collection) return;

			const { operation, rkey, record, cid } = ev.commit;
			const uri = `at://${ev.did}/${config.collection}/${rkey}`;
			if (config.hidden.has(uri) || config.hidden.has(ev.did)) return;

			if (operation === 'delete') {
				store.remove(uri);
				return;
			}
			if (!record) return;

			try {
				await resolveAuthor(ev.did);
			} catch {
				/* card still shows, with the bare DID */
			}
			const prev = store.tiles.get(uri);
			const tile = normalize(config.collection, ev.did, rkey, cid, record, prev?.firstSeen);
			tile.fresh = true;
			store.put(tile);
			setTimeout(() => {
				tile.fresh = false;
				store.changed();
			}, 4000);
		};
	}

	connect();
}
