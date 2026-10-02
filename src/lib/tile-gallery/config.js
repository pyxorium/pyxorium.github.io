// Settings for the Web Tiles gallery (/webtiles/gallery).
//
// Upgrade path:
//   1. Today: `source: 'network'` reads straight from the relay and each
//      author's PDS in the visitor's browser.
//   2. Later: set `source: 'indexer'` and `indexerUrl` once the Fly.io
//      indexer exists (see sources/indexer.js for the expected API).
//   3. Later: set `livePreviews: true` to add a "Preview" button to each
//      card that renders the real tile via @dasl/tile-loader (see render.js).

export const CONFIG = {
	collection: 'ing.dasl.masl',

	source: 'network', // 'network' | 'indexer'
	indexerUrl: '', // e.g. 'https://api.thunderbird.cafe'

	relay: 'https://relay1.us-east.bsky.network',
	jetstream: 'wss://jetstream2.us-east.bsky.network/subscribe',
	plc: 'https://plc.directory',
	handleResolver: 'https://public.api.bsky.app',

	// "Open" link on each card; the tile's at:// URI is appended.
	viewer: 'https://webtil.es/browser/#url=',

	// Same loading domain WebTile.astro uses, for when previews are switched on.
	livePreviews: false,
	loadDomain: 'load.tiles.thunderbird.cafe',

	// Card images load from each author's own PDS.
	showImagesByDefault: true,

	concurrency: 6,

	// at:// URIs or DIDs to leave out of the gallery entirely.
	hidden: new Set([
		// 'at://did:plc:example/ing.dasl.masl/3abcdefghijkl',
		// 'did:plc:example',
	]),
};
