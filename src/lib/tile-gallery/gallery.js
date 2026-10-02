// Entry point for /webtiles/gallery. Wires the source, live feed,
// controls and renderer together. Each of those lives in its own
// module so it can be swapped without touching the others.

import { CONFIG } from './config.js';
import { TileStore } from './store.js';
import { createResolver } from './identity.js';
import { connectLive } from './live.js';
import { renderCard } from './render.js';
import { backfill as networkBackfill } from './sources/network.js';
import { backfill as indexerBackfill } from './sources/indexer.js';

const SOURCES = { network: networkBackfill, indexer: indexerBackfill };

export function initGallery(root, config = CONFIG) {
	const q = (name) => root.querySelector(`[data-tg="${name}"]`);
	const el = {
		grid: q('grid'),
		status: q('status'),
		nTiles: q('n-tiles'),
		nAuthors: q('n-authors'),
		live: q('live'),
		liveText: q('live-text'),
		search: q('search'),
		author: q('author'),
		sort: q('sort'),
		images: q('images'),
		exportCsv: q('export'),
	};
	el.images.checked = config.showImagesByDefault;

	const store = new TileStore();
	const resolveAuthor = createResolver(config, store);
	const cards = new Map(); // uri -> { node, sig }
	const previewing = new Set(); // uris with a live preview mounted

	const setStatus = (t) => (el.status.textContent = t);

	/* ---------- filtering and sorting ---------- */
	function visibleTiles() {
		const text = el.search.value.trim().toLowerCase();
		const who = el.author.value;
		let list = [...store.tiles.values()];
		if (who) list = list.filter((t) => t.did === who);
		if (text) {
			list = list.filter((t) => {
				const a = store.authors.get(t.did);
				return [t.name, t.description, a?.handle, t.did].some((s) => s && s.toLowerCase().includes(text));
			});
		}
		const time = (t) => t.date?.getTime() ?? 0;
		const handle = (t) => store.authors.get(t.did)?.handle || t.did;
		const sorters = {
			new: (x, y) => time(y) - time(x),
			old: (x, y) => time(x) - time(y),
			author: (x, y) => handle(x).localeCompare(handle(y)) || time(y) - time(x),
			name: (x, y) => x.name.localeCompare(y.name),
		};
		return list.sort(sorters[el.sort.value] || sorters.new);
	}

	/* ---------- rendering (keyed, so live previews survive updates) ---------- */
	function render() {
		const show = el.images.checked;
		const list = visibleTiles();
		const nodes = [];

		for (const tile of list) {
			const author = store.authors.get(tile.did);
			const html = renderCard(config, tile, author, show);
			const sig = html + tile.fresh;
			let entry = cards.get(tile.uri);
			if (!entry) {
				const node = document.createElement('article');
				node.className = 'tg-card';
				node.dataset.uri = tile.uri;
				entry = { node, sig: null };
				cards.set(tile.uri, entry);
			}
			if (entry.sig !== sig && !previewing.has(tile.uri)) {
				entry.node.innerHTML = html;
				entry.sig = sig;
			}
			entry.node.classList.toggle('tg-fresh', tile.fresh);
			nodes.push(entry.node);
		}

		// Drop cards for deleted tiles.
		for (const uri of cards.keys()) {
			if (!store.tiles.has(uri)) {
				cards.delete(uri);
				previewing.delete(uri);
			}
		}

		// Only re-order the DOM when the order actually changed: moving a
		// node that holds an iframe would reload the tile inside it.
		const current = [...el.grid.children].filter((n) => n.classList.contains('tg-card'));
		const same = current.length === nodes.length && current.every((n, i) => n === nodes[i]);
		if (!same) el.grid.replaceChildren(...nodes);
		if (!nodes.length) el.grid.innerHTML = `<p class="tg-empty">${store.tiles.size ? 'No tiles match.' : ''}</p>`;

		el.nTiles.textContent = store.tiles.size;
		const dids = new Set([...store.tiles.values()].map((t) => t.did));
		el.nAuthors.textContent = dids.size;
		updateAuthorSelect(dids);
	}

	function updateAuthorSelect(dids) {
		const sel = el.author;
		const opts = [...dids]
			.map((d) => ({ d, h: store.authors.get(d)?.handle || d }))
			.sort((a, b) => a.h.localeCompare(b.h));
		const sig = opts.map((o) => o.d + o.h).join('|');
		if (sel.dataset.sig === sig) return;
		sel.dataset.sig = sig;
		const cur = sel.value;
		sel.replaceChildren(new Option('All authors', ''), ...opts.map((o) => new Option(o.h, o.d)));
		sel.value = cur;
	}

	/* ---------- CSV export of what's currently shown ---------- */
	function exportCsv() {
		const cols = [
			'at_uri', 'did', 'handle', 'handle_verified', 'name', 'description', 'createdAt',
			'date_used', 'date_source', 'first_seen_by_page', 'record_cid', 'masl_cid',
			'resource_count', 'total_bytes',
		];
		const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
		const rows = visibleTiles().map((t) => {
			const a = store.authors.get(t.did);
			return [
				t.uri, t.did, a?.handle, a?.verified, t.name, t.description, t.createdAt?.toISOString(),
				t.date?.toISOString(), t.dateSource, t.firstSeen.toISOString(), t.recordCid, t.maslCid,
				t.resourceCount, t.totalBytes,
			].map(cell).join(',');
		});
		const blob = new Blob([cols.join(',') + '\n' + rows.join('\n')], { type: 'text/csv' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `web-tiles-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	/* ---------- events ---------- */
	for (const c of [el.search, el.author, el.sort]) c.addEventListener('input', () => store.changed());
	el.images.addEventListener('input', () => {
		for (const e of cards.values()) e.sig = null; // force thumbs to redraw
		store.changed();
	});
	el.exportCsv.addEventListener('click', exportCsv);

	el.grid.addEventListener('click', async (e) => {
		const copy = e.target.closest('[data-copy]');
		if (copy) {
			navigator.clipboard?.writeText(copy.dataset.copy).then(() => {
				const old = copy.textContent;
				copy.textContent = 'Copied';
				setTimeout(() => (copy.textContent = old), 1200);
			});
			return;
		}
		const prev = e.target.closest('[data-preview]');
		if (prev && config.livePreviews) {
			const uri = prev.dataset.preview;
			const thumb = prev.closest('.tg-card')?.querySelector('.tg-thumb');
			if (!thumb || previewing.has(uri)) return;
			previewing.add(uri);
			prev.disabled = true;
			const { mountPreview } = await import('./preview.js');
			mountPreview(config, uri, thumb);
		}
	});

	// Broken images fall back to the placeholder.
	el.grid.addEventListener(
		'error',
		(e) => {
			const img = e.target;
			if (img instanceof HTMLImageElement && img.hasAttribute('data-fallback')) {
				const ph = document.createElement('span');
				ph.className = 'tg-ph';
				ph.textContent = '▦';
				img.replaceWith(ph);
			}
		},
		true,
	);

	store.onChange(render);

	/* ---------- start ---------- */
	// Listen first, so nothing published during the backfill is missed.
	connectLive(config, store, resolveAuthor, (on) => {
		el.live.classList.toggle('tg-on', on);
		el.liveText.textContent = on ? 'Live' : 'Reconnecting…';
	});

	const load = SOURCES[config.source] || SOURCES.network;
	load(config, store, resolveAuthor, setStatus)
		.then(({ authors, failed }) => {
			setStatus(
				`Checked ${authors} accounts` +
					(failed ? ` (${failed} could not be reached)` : '') +
					'. New tiles appear here as they are published.',
			);
		})
		.catch((err) => setStatus(`Could not load tiles: ${err.message}`));
}
