// Settings for the Web Tiles gallery (/webtiles/gallery).
//
// Upgrade path:
//   1. Today: `source: 'network'` reads straight from the relay and each
//      author's PDS in the visitor's browser.
//   2. Later: set `source: 'indexer'` and `indexerUrl` once the Fly.io
//      indexer exists (see sources/indexer.js for the expected API).
//   3. Done: `livePreviews: true` gives each card a "Preview" button that
//      runs the real tile in a pop-up, one at a time (see preview.js).

const THUNDERBIRD = 'did:plc:6vxjigxrqizmbo56gojxico3'; // thunderbird.cafe
const COLORADO = 'did:plc:ro563p5faldqu44apudq44k4'; // colorado.atprotocol.space
const tile = (did, rkey) => `at://${did}/ing.dasl.masl/${rkey}`;

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

	// Live previews: a pop-up that runs one tile at a time, through the same
	// loading server WebTile.astro uses.
	livePreviews: true,
	loadDomain: 'load.tiles.thunderbird.cafe',
	// Pop-up size when a tile doesn't say what size it wants (pixels).
	previewDefault: { width: 720, height: 520 },

	// Tiles that only work together with other tiles, or with the page around
	// them. Their cards get a "Try the demo" link to the page where they work,
	// instead of a Preview button. Add an entry for each new demo like this.
	demoTiles: [
		{
			label: 'Try the demo',
			url: '/blog/wishes-color-scheme-demo/',
			tiles: [tile(THUNDERBIRD, '3mwm2sljdes2m'), tile(COLORADO, '3mwm2n3mnr42m')],
		},
		{
			label: 'Try the demo',
			url: '/blog/wishes-shared-die-demo/',
			tiles: [tile(THUNDERBIRD, '3mwr6fpldri2m'), tile(COLORADO, '3mwr5sobinc2f')],
		},
		{
			label: 'Try the demo',
			url: '/blog/cosmic-junkyard-tile/',
			tiles: [tile(THUNDERBIRD, '3mwvoqidyqd24')],
		},
	],

	// Card images load from each author's own PDS.
	showImagesByDefault: true,

	concurrency: 6,

	// at:// URIs or DIDs to leave out of the gallery entirely.
	hidden: new Set([
		// 'at://did:plc:example/ing.dasl.masl/3abcdefghijkl',
		// 'did:plc:example',
	]),
};
