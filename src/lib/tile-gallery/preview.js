// Live tile previews inside gallery cards. Off until CONFIG.livePreviews
// is true. Uses the same loader setup as src/components/WebTile.astro.
//
// Not yet exercised on the live site: when you switch it on, test a few
// tiles locally with `npm run dev` first.

let mothership = null;

async function getMothership(config) {
	if (mothership) return mothership;
	const { TileMothership } = await import('@dasl/tile-loader');
	const { ATTileLoader } = await import('@dasl/tile-loader/at');
	mothership = new TileMothership({ loadDomain: config.loadDomain });
	mothership.init();
	mothership.addLoader(new ATTileLoader());
	return mothership;
}

export async function mountPreview(config, uri, thumbEl, height = 360) {
	thumbEl.classList.add('tg-live');
	thumbEl.innerHTML = '<span class="tg-ph">Loading tile…</span>';
	try {
		const tl = await getMothership(config);
		const tile = await tl.loadTile(uri);
		if (!tile) throw new Error('not found');
		thumbEl.innerHTML = '';
		thumbEl.appendChild(await tile.renderContent(height));
	} catch (err) {
		console.error('Tile preview failed:', err);
		thumbEl.innerHTML = '<span class="tg-ph">Could not load this tile.</span>';
	}
}
