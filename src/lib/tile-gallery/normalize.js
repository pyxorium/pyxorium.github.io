// Turn an ing.dasl.masl record into the flat shape the gallery renders.
//
// Record shapes seen in the wild:
//   1. { cid, tile: { name, description, icons, screenshots, resources, sizing }, createdAt }
//   2. a flat MASL bundle: { name, description?, resources, ... }
//   3. a single-resource MASL: { src, name?, content-type, ... }

import { tidToDate } from './util.js';

const CID_RE = /^[a-z0-9]{20,120}$/;

function blobCid(res) {
	const l = res?.src?.ref?.$link || res?.src?.$link;
	return typeof l === 'string' && CID_RE.test(l) ? l : null;
}

function pickImage(t, resources) {
	if (!resources) return null;
	const tries = [];
	for (const s of Array.isArray(t.screenshots) ? t.screenshots : []) tries.push({ path: s.src, kind: 'shot' });
	const icons = Array.isArray(t.icons) ? [...t.icons] : [];
	icons.sort((x, y) => (parseInt(y.sizes) || 0) - (parseInt(x.sizes) || 0));
	for (const i of icons) tries.push({ path: i.src, kind: 'icon' });
	for (const c of tries) {
		const cid = blobCid(resources[c.path]);
		if (cid) return { cid, kind: c.kind };
	}
	return null;
}

export function normalize(collection, did, rkey, cid, value, firstSeen) {
	const t = value.tile || value;
	const resources = t.resources && typeof t.resources === 'object' ? t.resources : null;

	let resourceCount = 0;
	let totalBytes = 0;
	if (resources) {
		for (const r of Object.values(resources)) {
			resourceCount++;
			totalBytes += r?.src?.size || 0;
		}
	} else if (t.src) {
		resourceCount = 1;
		totalBytes = t.src.size || 0;
	}

	const created = value.createdAt ? new Date(value.createdAt) : null;
	const createdAt = created && !isNaN(created) ? created : null;

	// The tile's preferred size, if it gives a sensible one (pixels).
	const w = Number(t.sizing?.width);
	const h = Number(t.sizing?.height);
	const sizing = w >= 100 && w <= 4000 && h >= 100 && h <= 4000 ? { width: w, height: h } : null;

	return {
		uri: `at://${did}/${collection}/${rkey}`,
		did,
		rkey,
		recordCid: cid || '',
		maslCid: value.cid || '',
		name: t.name || '(untitled)',
		description: t.description || '',
		image: pickImage(t, resources),
		resourceCount,
		totalBytes,
		sizing,
		// The tile loader runs records shaped { tile: {...} } from did:plc or
		// did:web accounts. Older flat-shaped records can't be previewed.
		previewable: !!value.tile && /^did:(plc|web):/.test(did),
		createdAt,
		date: createdAt || tidToDate(rkey),
		dateSource: createdAt ? 'createdAt' : 'record key',
		firstSeen: firstSeen || new Date(),
		fresh: false,
	};
}
