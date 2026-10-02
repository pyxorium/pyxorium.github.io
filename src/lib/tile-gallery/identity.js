// Resolve a DID to its handle and PDS, and check the handle points back.

import { getJSON } from './util.js';

export function createResolver(config, store) {
	const pending = new Map();

	async function verifyHandle(a) {
		if (!a.handle) {
			a.verified = false;
			return;
		}
		try {
			const u = `${config.handleResolver}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(a.handle)}`;
			const j = await getJSON(u);
			a.verified = j.did === a.did;
		} catch {
			a.verified = false;
		}
		store.changed();
	}

	return function resolveAuthor(did) {
		if (store.authors.has(did)) return Promise.resolve(store.authors.get(did));
		if (pending.has(did)) return pending.get(did);

		const p = (async () => {
			let doc;
			if (did.startsWith('did:plc:')) doc = await getJSON(`${config.plc}/${did}`);
			else if (did.startsWith('did:web:')) doc = await getJSON(`https://${did.slice(8)}/.well-known/did.json`);
			else throw new Error('Unsupported DID method');

			const handle = (doc.alsoKnownAs || []).find((x) => x.startsWith('at://'))?.slice(5) || null;
			const pds = (doc.service || []).find(
				(s) => s.id === '#atproto_pds' || s.id === `${did}#atproto_pds`,
			)?.serviceEndpoint;

			const a = { did, handle, pds, verified: null };
			store.authors.set(did, a);
			verifyHandle(a);
			return a;
		})();

		pending.set(did, p);
		p.finally(() => pending.delete(did));
		return p;
	};
}
