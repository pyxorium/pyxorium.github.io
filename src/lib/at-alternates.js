// at-tags: the records a blog post shows beyond its tile embeds, by the post's slug (its file name in
// src/content/blog/). A record goes here if the post shows it (a demo runs it, or a screenshot is about it) or
// invites you to open it; not lexicon schemas, code examples or every supporting link. DID-form AT URIs only: a
// wrong address stops the build (src/lib/at-tags.js). Tile embeds (<WebTile>, <CosmicJunkyardDemo>) and the
// wishes posts' bobAtUri/aliceAtUri are read from the posts themselves.
//
// Kept here, not in the posts' front matter, because Sequoia compares each post's whole file: any edit there shows
// the post as "content changed" in its dry run. Changing this file never touches a post.

const T = 'did:plc:6vxjigxrqizmbo56gojxico3'; // thunderbird.cafe
const P = 'did:plc:rqbqpaaluty5v47jwciowpik'; // pyxorium.com
const W = 'did:plc:joer5rzmwgec3dkr4srfmq45'; // thunderbirdwine.bsky.social
const GOOSE = 'did:plc:hsqwcidfez66lwm3gxhfv5in'; // goose.art

const tile = (did, rkey) => `at://${did}/ing.dasl.masl/${rkey}`;
const MAZE_PLACE = `at://${P}/cafe.thunderbird.way.place/maze`;
const FOREST_PLACE = `at://${T}/cafe.thunderbird.way.place/winter-forest`;
const OBELISK = `at://${P}/cafe.thunderbird.way.signpost/maze.obelisk`;
const SLIDE = `at://${T}/cafe.thunderbird.way.signpost/winter-forest.slide`;
const SEVENUP = [tile(T, '3my27cwible2m'), tile(T, '3my27d43kry2d')]; // house, player
const DAISY = [tile(T, '3myfnyphiuw2t'), tile(T, '3myfnywxt6v2r')]; // house, player

export const AT_ALTERNATES = {
	// The demo runs the house and player tiles.
	'seven-up': SEVENUP,
	// Its screenshots are of a match at the Daisy table.
	daisy: DAISY,
	// The places and signposts the post shows (the maze tile comes from its embed).
	'ways-portal-loop': [MAZE_PLACE, FOREST_PLACE, OBELISK, SLIDE],
	// The maze's place and the slide's signpost in its screenshots; the Places and Signposts renderer tiles.
	'renderer-tiles': [MAZE_PLACE, SLIDE, tile(T, '3mzp2cmnlwa26'), tile(T, '3mzoty54cln2u')],
	// The crystal tile, the post's example.
	'tile-posts': [tile(W, '3n22c4q7vxsrg')],
	// The Live Pong tile it invites you to open.
	'live-pong': [tile(T, '3mzl5yvfay72f')],
	// The live poll tile.
	rooms: [tile(T, '3myn75d2d222d')],
	// goose.art's zine "chipmunks of maple pass" open in a tab, and a Daisy match in Raku.
	raku: [tile(GOOSE, '3mxgglpomrm2d'), ...DAISY],
	// The run the post shows (its JSON, the PDSls screenshot and the replay).
	'cosmic-junkyard-record': [`at://${T}/cafe.thunderbird.cosmicjunkyard.run/3n2ozrhmttkwk`],
	// The C120 tape and the No Expectations song post it invites you to open, and that post's song.
	'mixtape-burndown': [tile(P, '3n2jjchile422'), `at://${P}/cafe.thunderbird.tile.post/3n2smqmn5fko5`, `at://${P}/cafe.thunderbird.audio.track/3n2cz64eheg2v`],
	// The saved daily game in its PDSls screenshot (the tile comes from its embed).
	'prism-wasm-web-tile': [`at://${T}/cafe.thunderbird.prism.game/3n2x6qcq6jkxq`],
};
