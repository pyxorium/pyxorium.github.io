// config.js: Thunderbird Café Station (/webtiles/station/), a stop on the Smallweb Subway's Creatives Club line.
// Plan: claude/smallweb-subway-station-plan.md in the Foundry project (ST1 to ST14).
//
// The eight tiles, in the order agreed with the owner (ST4, ST9, ST11). `run` tiles (heavy WebGL) show their banner
// with ▶ RUN and load only when clicked; the others load as they come near (ST5). The maze's card carries the loop
// to Winter Forest and back (ST6, ST13). Pictures come straight from each account's server, as the Live Gallery
// does (src/lib/tile-gallery/render.js), except Pong's, a screenshot kept with this page (ST16; it replaced the
// Rotatable 3D Object Nov 3). Record CIDs are as read on Nov 2 2026 (Pong's wasn't read: it isn't used); the cards
// load each tile's current record, as the blog's embeds do.

const PDS = {
  thunderbird: 'https://fibercap.us-west.host.bsky.network',
  pyxorium: 'https://meadow.us-east.host.bsky.network',
  thunderbirdwine: 'https://brittlegill.us-west.host.bsky.network',
  colorado: 'https://stropharia.us-west.host.bsky.network',
};
const DID = {
  thunderbird: 'did:plc:6vxjigxrqizmbo56gojxico3',
  pyxorium: 'did:plc:rqbqpaaluty5v47jwciowpik',
  thunderbirdwine: 'did:plc:joer5rzmwgec3dkr4srfmq45',
  colorado: 'did:plc:ro563p5faldqu44apudq44k4',
};
const blob = (who, cid) => `${PDS[who]}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(DID[who])}&cid=${cid}`;
const tile = (who, rkey) => `at://${DID[who]}/ing.dasl.masl/${rkey}`;

export const raku = (uri) => `https://raku.lexicographer.space/#t=${encodeURIComponent(uri)}&a=0`;

export const TILES = [
  {
    id: 'pong', name: 'Pong', run: true,
    uri: tile('thunderbird', '3mwbkd6kudm2m'), cid: null,
    picture: '/webtiles/station/pong.jpg', pictureAlt: 'A game of Pong: two green paddles, a ball and the score, zero to zero',
    caption: 'A small game of Pong. Keep the rally going.',
    post: { href: '/blog/web-tiles-gallery/', label: 'read the post' },
  },
  {
    id: 'colorado', name: 'at-proto Colorado',
    uri: tile('colorado', '3mw7br7577s2n'), cid: 'bafyreig7sbz65dnvcoiuual67x7cc4x7wbznrrnnhjormdtxlpsb5ntj6i',
    picture: blob('colorado', 'bafkreib4nwhu4slhvrf7pcvpvhc3fzfp2lddshvwobo3vvigd56hipxbvy'),
    caption: 'A rounded cube with the @-proto Colorado logo. Give it a spin.',
    post: null,
  },
  {
    id: 'junkyard', name: 'Cosmic Junkyard',
    uri: tile('thunderbird', '3mwvoqidyqd24'), cid: 'bafyreiepbzbgw353thaydovj3o6m5xv2xhnokjznmqvmjm5mkvlh6edwpq',
    picture: blob('thunderbird', 'bafkreifoaqthvrudur5hkpxxkad2hom53c3kxebyvecw26zfs5skrbqc7a'),
    caption: 'Dodge falling dice, catch saucers and aliens.',
    post: { href: '/blog/cosmic-junkyard-tile/', label: 'read the post' },
  },
  {
    id: 'lantern', name: 'Glass Lantern',
    uri: tile('thunderbirdwine', '3mwz4el5wug24'), cid: 'bafyreianzvrrn2ymgqxhtiktaiwfytnamfv2cbwbypyirywwpcycfdcbki',
    picture: blob('thunderbirdwine', 'bafkreigdh22mporc46gpn6z3mi2p5dpyx4lz5nkgkoileeqg7ntkvmt4ke'),
    caption: 'A stained-glass die with a light inside. Drag to turn, tap to roll.',
    post: { href: '/blog/glass-lantern-and-coaster-carnival/', label: 'read the post' },
  },
  {
    id: 'coaster', name: 'Roller Coaster', run: true,
    uri: tile('pyxorium', '3mx6h2wjtgq2h'), cid: 'bafyreibelkqt6r5lscnohp7bqbjs6naw7pgkmghfbxi5s6m57cm2iapl7q',
    picture: blob('pyxorium', 'bafkreidardgm3sprwbh2xbgvdbdok6wqwncg3psjbt5yrb3da2z2536one'), pictureAlt: 'A roller coaster in the evening',
    caption: 'A coaster that’s one of a kind, made in the Foundry. Take a ride.',
    post: { href: '/blog/glass-lantern-and-coaster-carnival/', label: 'read the post' },
  },
  {
    id: 'this-and-that', name: 'This and That',
    uri: tile('pyxorium', '3mxkldvf54e2x'), cid: 'bafyreihuffxlfc2lroksqjn3kvds5qx4fvntoojg6okyznf3i6gijvinoq',
    picture: blob('pyxorium', 'bafkreieurwh3rs3mnkgqriusezdvt2jamfbr33j7izhkdpwtt2iy5yt3oq'),
    caption: 'A zine of random events from daily life.',
    post: { href: '/blog/zine-scene/', label: 'about Zine Scene' },
  },
  {
    id: 'blues-trio', name: 'Blues Trio',
    uri: tile('pyxorium', '3mxnbof4bsr2r'), cid: 'bafyreih7ko3kkitmr75izmzux4fbkf7zbc6qe32okang33vdrx23yyn3ni',
    picture: blob('pyxorium', 'bafkreifio2hw5d2hm42fzvrdxjh2qitw7a5c7j3hqtz4qa24jjoydb7p5i'),
    caption: 'A 12-bar blues built one instrument at a time, in live ATMOSYNTH patches.',
    post: { href: '/blog/zine-scene/', label: 'about Zine Scene' },
  },
  {
    id: 'maze', name: 'Escher Maze', run: true, loop: true,
    uri: tile('pyxorium', '3myyjuyr2ja2s'), cid: 'bafyreigfeq5q5ba4ba2jkckcn7sarurbrmnpfssmacakujbcecultm77tu',
    picture: blob('pyxorium', 'bafkreiaepxqy7af5ct3v7ejmgii7t6prb2q4djh2gwucw6w7jvkubve46y'), pictureAlt: 'Rooms of an impossible maze',
    caption: 'Wander an impossible place. The obelisk leads to Winter Forest, and the forest’s slide brings you back.',
    post: { href: '/blog/ways-portal-loop/', label: 'read the post' },
  },
];

// The maze card starts from the signpost that leads into the maze (the forest's slide), at the maze's own first
// entrance (ST13). The obelisk and the slide then carry the trip as on the travel pages.
export const LOOP = {
  signpost: 'at://did:plc:6vxjigxrqizmbo56gojxico3/cafe.thunderbird.way.signpost/winter-forest.slide',
  rkey: 'winter-forest.slide',
};

// Gus's widget (ST3) and its two inline button handlers, allowed by their hashes (ST12, option A).
export const SUBWAY_SCRIPT = 'https://gusbus.space/smallweb-subway.js/creativesclub.js';
export const SUBWAY_HANDLERS = Object.freeze({
  'goToPrev_creativesclub()': 'sha256-kPuJYfBoG8bqLyUHRzR/9wfaIAbsGJUQ4Gy2dTsmjb8=',
  'goToNext_creativesclub()': 'sha256-55FanF4b4DvPe5l5UYznldg98CTAAvo03AMj4LCXsBI=',
});

// The page's security policy, a <meta> on the built page only (Astro's dev server adds inline scripts of its own).
// Based on the way pages' (src/way/page-csp.js): lookups and pictures over https, frames only from the tile loading
// server; plus Gus's script, its two handlers, and Google Fonts as the rest of the site.
export function pageCsp(loadDomain) {
  const base = loadDomain.replace(/^load\./, '');
  return [
    "default-src 'self'",
    `script-src 'self' https://gusbus.space 'unsafe-hashes' ${Object.values(SUBWAY_HANDLERS).map((h) => `'${h}'`).join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' https: data: blob:",
    "connect-src 'self' https:",
    `frame-src https://${loadDomain} https://*.${base}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

// The 88×31 buttons in the footer (ST7).
export const BUTTONS = [
  { href: 'https://thunderbird.cafe/', cls: 'a', html: 'THUNDERBIRD<br>CAFE', label: 'thunderbird.cafe' },
  { href: 'https://raku.lexicographer.space/', cls: 'b', html: 'RAKU<br>tile browser', label: 'Raku, a browser for web tiles' },
  { href: 'https://lexicographer.space/', cls: 'c', html: 'lexicographer<br>.space', label: 'lexicographer.space' },
  { href: 'https://foundry.thunderbird.cafe/', cls: 'd', html: 'THE FOUNDRY', label: 'The Web Tile Foundry' },
  { href: 'https://gusbus.space/smallweb-subway/', cls: 'e', html: 'SMALLWEB SUBWAY', label: 'The Smallweb Subway' },
  { href: '/webtiles/gallery/', cls: 'f', html: 'LIVE GALLERY', label: 'The Live Gallery of every web tile' },
];
