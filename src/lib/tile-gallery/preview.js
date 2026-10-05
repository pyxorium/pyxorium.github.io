// Live tile previews: a pop-up window that runs one tile at a time.
//
// Opening a preview closes any previous one, and closing the pop-up removes
// the tile entirely, so at most one tile runs on the page. All previews share
// one tile loader (two loaders on one page would both hear every tile's
// messages). Tiles load through the same loading server as WebTile.astro,
// using our AT loader, which also handles did:web accounts.

let mothership = null;
let dialog = null;
let loadToken = 0;

async function getMothership(config) {
	if (mothership) return mothership;
	const { TileMothership } = await import('@dasl/tile-loader');
	const { ATTileLoaderWithDidWeb } = await import('../at-tile-loader.js');
	mothership = new TileMothership({ loadDomain: config.loadDomain });
	mothership.init();
	mothership.addLoader(new ATTileLoaderWithDidWeb());
	return mothership;
}

function getDialog() {
	if (dialog) return dialog;
	dialog = document.createElement('dialog');
	dialog.className = 'tg-modal';
	dialog.setAttribute('aria-labelledby', 'tg-modal-title');
	dialog.innerHTML = `
		<div class="tg-modal-head">
			<div class="tg-modal-titles">
				<h2 class="tg-modal-title" id="tg-modal-title"></h2>
				<p class="tg-modal-by"></p>
			</div>
			<button type="button" class="tg-modal-close" aria-label="Close preview">×</button>
		</div>
		<div class="tg-modal-stage"></div>
		<p class="tg-modal-note">
			Tiles run in a sandbox and can't reach the network. Some tiles are designed to work
			alongside other tiles, or the page around them, and may do little on their own.
		</p>`;
	document.body.appendChild(dialog);

	dialog.querySelector('.tg-modal-close').addEventListener('click', closePreview);
	// Clicking the dimmed area outside the pop-up closes it.
	dialog.addEventListener('click', (e) => {
		if (e.target === dialog) closePreview();
	});
	// The Escape key closes the dialog by itself. 'cancel' fires the moment
	// it's pressed; 'close' is a backup that arrives slightly later, so it
	// only acts if the pop-up is still closed by then.
	dialog.addEventListener('cancel', stopTile);
	dialog.addEventListener('close', () => {
		if (!dialog.open) stopTile();
	});
	return dialog;
}

// Remove the running tile (or cancel one that's still loading).
function stopTile() {
	loadToken++;
	dialog?.querySelector('.tg-modal-stage').replaceChildren();
}

export function closePreview() {
	stopTile();
	if (dialog?.open) dialog.close();
}

function message(text) {
	const p = document.createElement('p');
	p.className = 'tg-modal-msg';
	p.textContent = text;
	return p;
}

export async function openPreview(config, tile, author) {
	const dlg = getDialog();
	stopTile(); // one preview at a time: remove any previous tile first
	const token = loadToken;

	// Size the pop-up for the tile, within the visible window.
	const want = tile.sizing || config.previewDefault;
	const viewW = document.documentElement.clientWidth; // excludes the scrollbar
	const width = Math.max(240, Math.min(want.width, viewW - 72));
	const height = Math.max(200, Math.min(want.height, Math.round(window.innerHeight * 0.7)));

	dlg.querySelector('.tg-modal-title').textContent = tile.name;
	dlg.querySelector('.tg-modal-by').textContent = author?.handle ? `by @${author.handle}` : tile.did;
	const stage = dlg.querySelector('.tg-modal-stage');
	stage.style.width = `${width}px`;
	stage.style.height = `${height}px`;
	stage.replaceChildren(message('Loading tile…'));
	if (!dlg.open) dlg.showModal();

	try {
		const tl = await getMothership(config);
		const loaded = await tl.loadTile(tile.uri);
		if (token !== loadToken) return; // closed, or another preview opened
		if (!loaded) throw new Error('not found');
		const frame = await loaded.renderContent(height);
		if (token !== loadToken || !dlg.open) return;
		stage.replaceChildren(frame);
	} catch (err) {
		console.error('Tile preview failed:', err);
		if (token === loadToken) stage.replaceChildren(message('Could not load this tile.'));
	}
}
