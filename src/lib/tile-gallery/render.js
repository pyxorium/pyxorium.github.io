// Card markup. Everything that comes from a record is escaped.
//
// `renderThumb` is the one place that decides what sits at the top of a
// card. Today that's the tile's screenshot or icon; with
// CONFIG.livePreviews on, the card also gets a "Preview" button, and
// preview.js swaps the thumb for the running tile.

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
			<a href="${esc(config.viewer + tile.uri)}" target="_blank" rel="noopener noreferrer">Open</a>
			${config.livePreviews ? `<button type="button" data-preview="${esc(tile.uri)}">Preview</button>` : ''}
			${recordUrl ? `<a href="${esc(recordUrl)}" target="_blank" rel="noopener noreferrer">Record</a>` : ''}
			<button type="button" data-copy="${esc(tile.uri)}">Copy at://</button>
		</div>`;
}
