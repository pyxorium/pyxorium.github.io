// Checks src/lib/at-tags.js, and the at-tags every blog post gets from its front matter and text.
// Run from C:\thunderbird-cafe\pyxorium.github.io: node --test test/at-tags.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { isRecordUri, embeddedRecords, postAtTags, pageAlternates, PUBLICATION, SITE_ME } from '../src/lib/at-tags.js';
import { AT_ALTERNATES } from '../src/lib/at-alternates.js';
import { PUBLISHED as SEVENUP } from '../src/sevenup/published.generated.js';
import { PUBLISHED as DAISY } from '../src/daisy/published.generated.js';
import { TILES as STATION, LOOP } from '../src/station/config.js';

const BLOG = fileURLToPath(new URL('../src/content/blog/', import.meta.url));

const T = 'did:plc:6vxjigxrqizmbo56gojxico3'; // thunderbird.cafe
const P = 'did:plc:rqbqpaaluty5v47jwciowpik'; // pyxorium.com
const W = 'did:plc:joer5rzmwgec3dkr4srfmq45'; // thunderbirdwine.bsky.social
const C = 'did:plc:ro563p5faldqu44apudq44k4'; // colorado.atprotocol.space
const G = 'did:plc:hsqwcidfez66lwm3gxhfv5in'; // goose.art
const tile = (did, rkey) => `at://${did}/ing.dasl.masl/${rkey}`;
const doc = (rkey) => `at://${T}/site.standard.document/${rkey}`;
const MAZE_PLACE = `at://${P}/cafe.thunderbird.way.place/maze`;
const FOREST_PLACE = `at://${T}/cafe.thunderbird.way.place/winter-forest`;
const OBELISK = `at://${P}/cafe.thunderbird.way.signpost/maze.obelisk`;
const SLIDE = `at://${T}/cafe.thunderbird.way.signpost/winter-forest.slide`;

// Every post: its own record, and what it shows after the publication (in order: embeds, wishes, AT_ALTERNATES).
const EXPECTED = {
	'contagion-web-tile-promises': [doc('3n35ohldcmp2h'), [tile(T, '3n33t44ehtksx'), `at://${T}/cafe.thunderbird.contagion.game/3n35fdoxrgcj2`]],
	'cosmic-junkyard-record': [doc('3n2pfh3jknp2b'), [tile(T, '3mwvoqidyqd24'), `at://${T}/cafe.thunderbird.cosmicjunkyard.run/3n2ozrhmttkwk`]],
	'cosmic-junkyard-tile': [doc('3mwvrzywwxc2d'), [tile(T, '3mwvoqidyqd24')]],
	'cross-tile-intrazine': [doc('3mxtw5l6in62n'), [tile(P, '3mxsmot7wxa22')]],
	daisy: [doc('3my75rsxjyu2n'), [tile(T, '3myfnyphiuw2t'), tile(T, '3myfnywxt6v2r')]],
	'embedding-a-web-tile': [doc('3mwjap2qjij2v'), [tile(T, '3mw763im3qw2t')]],
	'glass-lantern-and-coaster-carnival': [doc('3mxc5j2nfvu2w'), [tile(W, '3mwz4el5wug24'), tile(P, '3mx6h2wjtgq2h')]],
	'live-pong': [doc('3mzlvloylkq2g'), [tile(T, '3mzl5yvfay72f')]],
	'mixtape-burndown': [doc('3n2ttk6z37l2p'), [tile(P, '3n2jjchile422'), `at://${P}/cafe.thunderbird.tile.post/3n2smqmn5fko5`, `at://${P}/cafe.thunderbird.audio.track/3n2cz64eheg2v`]],
	'mixtape-c60': [doc('3mxau3yctbh2w'), [tile(P, '3mx7opazqwe2a')]],
	'prism-wasm-web-tile': [doc('3n2xjaqx5dj2a'), [tile(T, '3n2ww7ntilcx6'), `at://${T}/cafe.thunderbird.prism.game/3n2x6qcq6jkxq`]],
	raku: [doc('3mykkt54p5t26'), [tile(G, '3mxgglpomrm2d'), tile(T, '3myfnyphiuw2t'), tile(T, '3myfnywxt6v2r')]],
	'renderer-tiles': [doc('3mzqerccutl2k'), [MAZE_PLACE, SLIDE, tile(T, '3mzp2cmnlwa26'), tile(T, '3mzoty54cln2u')]],
	rooms: [doc('3mzir2h5j5e2z'), [tile(T, '3myn75d2d222d')]],
	'seven-up': [doc('3my3evqeicw2v'), [tile(T, '3my27cwible2m'), tile(T, '3my27d43kry2d')]],
	'tile-files': [doc('3n2ridfza5h2s'), []],
	'tile-posts': [doc('3n24zywptby2c'), [tile(W, '3n22c4q7vxsrg')]],
	'ways-portal-loop': [doc('3myzcrzmmll2f'), [tile(P, '3myyjuyr2ja2s'), MAZE_PLACE, FOREST_PLACE, OBELISK, SLIDE]],
	'web-tile-foundry': [doc('3mwwkptwny32r'), [tile(W, '3mwwhkjfvfq2o')]],
	'web-tiles-gallery': [doc('3mwu6ozmlu324'), [tile(T, '3mwbkd6kudm2m')]],
	'wishes-color-scheme-demo': [doc('3mwme2l3tll2z'), [tile(C, '3mwm2n3mnr42m'), tile(T, '3mwm2sljdes2m')]],
	'wishes-shared-die-demo': [doc('3mwrpl3tq372z'), [tile(C, '3mwr5sobinc2f'), tile(T, '3mwr6fpldri2m')]],
	'zine-scene': [doc('3mxi4feam252v'), [tile(P, '3mxhzu3ucgn2x')]],
};

// Just enough front matter for these fields: `key: value` lines and `key:` followed by `  - value` lines.
function readPost(file) {
	const text = readFileSync(join(BLOG, file), 'utf8').replace(/\r\n/g, '\n');
	const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
	assert.ok(m, `${file}: front matter`);
	const data = {};
	let list = null;
	for (const line of m[1].split('\n')) {
		const item = /^\s+-\s+(.*)$/.exec(line);
		if (item && list) { list.push(unquote(item[1])); continue; }
		const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
		if (!kv) continue;
		list = null;
		if (kv[2] === '') data[kv[1]] = list = [];
		else data[kv[1]] = unquote(kv[2]);
	}
	return { data, body: m[2] };
}
const unquote = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2');

test('every post in src/content/blog has an expected list here', () => {
	const slugs = readdirSync(BLOG).filter((f) => /\.mdx?$/.test(f)).map((f) => f.replace(/\.mdx?$/, '')).sort();
	assert.deepEqual(slugs, Object.keys(EXPECTED).sort());
});

for (const [slug, [canonical, shows]] of Object.entries(EXPECTED)) {
	test(`${slug}: exactly the agreed tags`, () => {
		const { data, body } = readPost(`${slug}.mdx`);
		const tags = postAtTags({ id: slug, ...data, body, extra: AT_ALTERNATES[slug] ?? [] });
		assert.deepEqual(tags.canonical, [canonical]);
		assert.equal(tags.document, canonical);
		assert.deepEqual(tags.author, [SITE_ME]);
		assert.deepEqual(tags.alternate, [PUBLICATION, ...shows]);
		for (const uri of [...tags.canonical, ...tags.alternate]) assert.ok(isRecordUri(uri), uri);
	});
}

test('the site and its publication', () => {
	assert.equal(SITE_ME, `at://${T}`);
	assert.equal(PUBLICATION, `at://${T}/site.standard.publication/3mwhy6xsszo27`);
	const wellKnown = readFileSync(fileURLToPath(new URL('../public/.well-known/site.standard.publication', import.meta.url)), 'utf8');
	assert.equal(wellKnown.trim(), PUBLICATION);
});

test('a post without atUri yet: no canonical, no standard.site link, no publication; still embeds and author', () => {
	const tags = postAtTags({ id: 'new', body: `<WebTile uri="${tile(T, '3mwbkd6kudm2m')}" height={400} />` });
	assert.deepEqual(tags.canonical, []);
	assert.equal(tags.document, null);
	assert.deepEqual(tags.alternate, [tile(T, '3mwbkd6kudm2m')]);
	assert.deepEqual(tags.author, [SITE_ME]);
});

test('embeds: code and placeholders never count; repeats once', () => {
	const real = tile(P, '3myyjuyr2ja2s');
	const body = [
		'Use `<WebTile uri="at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/ing.dasl.masl/inline" />` like this.',
		'```mdx',
		`<WebTile uri="${tile(W, '3mwz4el5wug24')}" />`,
		'```',
		'<WebTile uri="at://…" />',
		'<WebTile uri="at://thunderbird.cafe/ing.dasl.masl/3mwbkd6kudm2m" />',
		`<WebTile uri="${real}" height={480} />`,
		`<CosmicJunkyardDemo uri='${real}' />`,
	].join('\n');
	assert.deepEqual(embeddedRecords(body), [real, real]);
	assert.deepEqual(postAtTags({ body }).alternate, [real]);
});

test('every AT_ALTERNATES entry names a real post', () => {
	const slugs = Object.keys(EXPECTED);
	for (const slug of Object.keys(AT_ALTERNATES)) assert.ok(slugs.includes(slug), slug);
});

test('posts keep no at-tags lists in their front matter (Sequoia would see them as changed)', () => {
	for (const slug of Object.keys(EXPECTED)) assert.ok(!('atAlternate' in readPost(`${slug}.mdx`).data), slug);
});

test('a wrong address stops the build', () => {
	assert.throws(() => postAtTags({ id: 'x', extra: ['at://pyxorium.com/cafe.thunderbird.way.place/maze'] }), /DID-form/);
	assert.throws(() => postAtTags({ id: 'x', extra: [`at://${T}`] }), /DID-form/);
	assert.throws(() => postAtTags({ id: 'x', atUri: 'at://…' }), /DID-form/);
});

test('record addresses', () => {
	assert.ok(isRecordUri(SLIDE));
	assert.ok(isRecordUri('at://did:web:example.com/ing.dasl.masl/3abc'));
	assert.ok(!isRecordUri(`at://${T}`));
	assert.ok(!isRecordUri(`at://${T}/ing.dasl.masl`));
	assert.ok(!isRecordUri('at://goose.art/ing.dasl.masl/3mxgglpomrm2d'));
	assert.ok(!isRecordUri(`at://${T}/ing.dasl.masl/3abc?x=1`));
	assert.ok(!isRecordUri(`at://${T}/ing.dasl.masl/3abc"><script>`));
});

test('the Seven-Up, Daisy and Station pages', () => {
	assert.deepEqual(pageAlternates([SEVENUP.house?.uri, SEVENUP.player?.uri]), [tile(T, '3my27cwible2m'), tile(T, '3my27d43kry2d')]);
	assert.deepEqual(pageAlternates([DAISY.house?.uri, DAISY.player?.uri]), [tile(T, '3myfnyphiuw2t'), tile(T, '3myfnywxt6v2r')]);
	const station = pageAlternates([...STATION.map((t) => t.uri), LOOP.signpost]);
	assert.equal(station.length, 12);   // eleven tiles (Prism since Nov 22, popcorn tea since Nov 23, Contagion since Nov 24) and the slide's signpost
	assert.equal(station.at(-1), SLIDE);
	assert.deepEqual(pageAlternates([null, tile(T, '3my27cwible2m'), tile(T, '3my27cwible2m')]), [tile(T, '3my27cwible2m')]);
});
