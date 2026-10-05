// Card markup. Everything that comes from a record is escaped.
//
// `renderThumb` decides what sits at the top of a card: the tile's
// screenshot or icon. `renderPrimaryAction` adds either a "Preview" button
// (runs the tile in a pop-up, see preview.js) or, for tiles that need their
// demo page, a "Try the demo" link.

import { esc, fmtDate, fmtBytes } from './util.js';

const PLACEHOLDER = `<span class="tg-ph" aria-hidden="true">▦</span>`;

function renderThumb(tile, author, showImages) {
	if (!showImages || !tile.image || !author?.pds) return `<div class="tg-thumb tg-noimg">${PLACEHOLDER}</div>`;
	const src = `${author.pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(tile.did)}&cid=${tile.image.cid}`;
	return `<div class="tg-thumb"><img loading="lazy" referrerpolicy="no-referrer" alt=""
		class="${tile.image.kind === 'icon' ? 'tg-icon' : ''}" src="${esc(src)}" data-fallback></div>`;
}

function renderAuthor(author, did) {
	const name = author?.handle ? `@${author.handle}` : did;
	// Only the positive result is shown; a failed check is in the CSV export.
	const badge =
		author?.verified === true
			? `<span class="tg-badge tg-ok" title="This handle currently resolves back to this account">✓</span>`
			: '';
	return `<span class="tg-author" title="${esc(did)}">${esc(name)}</span>${badge}`;
}

export function renderCard(config, tile, author, showImages) {
	const recordUrl = author?.pds
		? `${author.pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(tile.did)}&collection=${config.collection}&rkey=${encodeURIComponent(tile.rkey)}`
		: '';
	const dateNote = tile.dateSource === 'createdAt' ? '' : '*';
	const files = `${tile.resourceCount} file${tile.resourceCount === 1 ? '' : 's'}`;

	return `
		${renderThumb(tile, author, showImages)}
		<div class="tg-body">
			<h2 class="tg-name">${esc(tile.name)}</h2>
			${tile.description ? `<p class="tg-desc">${esc(tile.description)}</p>` : ''}
			<div class="tg-meta">
				${renderAuthor(author, tile.did)}
				<span title="Date source: ${esc(tile.dateSource)}">${fmtDate(tile.date)}${dateNote}</span>
				<span>${files} · ${fmtBytes(tile.totalBytes)}</span>
			</div>
		</div>
		<div class="tg-links">
			${renderPrimaryAction(config, tile)}
			<a href="${esc(config.viewer + tile.uri)}" target="_blank" rel="noopener noreferrer">Open</a>
			${recordUrl ? `<a href="${esc(recordUrl)}" target="_blank" rel="noopener noreferrer">Record</a>` : ''}
			<button type="button" data-copy="${esc(tile.uri)}">Copy at://</button>
		</div>`;
}

// Tiles listed in CONFIG.demoTiles only work alongside other tiles or their
// page, so they link to that page. Other tiles get a Preview button.
let demoByUri = null;
function demoFor(config, uri) {
	if (!demoByUri) {
		demoByUri = new Map();
		for (const d of config.demoTiles || []) for (const u of d.tiles) demoByUri.set(u, d);
	}
	return demoByUri.get(uri);
}

function renderPrimaryAction(config, tile) {
	const demo = demoFor(config, tile.uri);
	if (demo) return `<a class="tg-primary" href="${esc(demo.url)}">${esc(demo.label || 'Try the demo')}</a>`;
	if (config.livePreviews && tile.previewable) {
		return `<button type="button" class="tg-primary" data-preview="${esc(tile.uri)}">Preview</button>`;
	}
	return '';
}
