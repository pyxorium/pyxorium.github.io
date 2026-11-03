// check_gallery.mjs: the gallery's repeats in a browser (src/lib/tile-gallery/repeats.js; the Foundry project's
// claude/raku-recent-repeats.md, G1). The page's own markup and styles (read from src/pages/webtiles/gallery.astro
// and src/styles/global.css), the gallery's real code bundled with esbuild, and stand-ins for the network: the relay's
// list of accounts, the account directory, the handle check, each account's records, and Jetstream (live).
//
//   - repeats (same account, name and description) show as one card, the newest, "+5 earlier versions";
//   - same name with other descriptions, other accounts, and untitled tiles stay as they are;
//   - the line opens the group in place (the earlier copies after the card, newest first) and closes it;
//   - a tile arriving live joins its group (it becomes the card, the count grows); a deleted card hands over;
//   - the header counts every tile; CSV exports every tile; search and the author menu show the group; sorts; phone.
//
// Needs Playwright and esbuild (not installed in this folder; it runs in the chat sandbox):
//   node test/gallery/check_gallery.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const load = (name) => { try { return require(name); } catch { return require(`/opt/npm-tools/node_modules/${name}`); } };
const { chromium } = load('playwright');
const esbuild = load('esbuild');
const SITE = new URL('../../', import.meta.url);
const step = (s) => console.log(`- ${s}`);

// ---- the page: its markup and styles, the gallery bundled ----
const astro = await readFile(new URL('src/pages/webtiles/gallery.astro', SITE), 'utf8');
const main = astro.match(/<main[\s\S]*?<\/main>/)[0];
const style = astro.match(/<style is:global>([\s\S]*?)<\/style>/)[1];
const globalCss = await readFile(new URL('src/styles/global.css', SITE), 'utf8');
const bundle = await esbuild.build({
	stdin: { contents: "import { initGallery } from './src/lib/tile-gallery/gallery.js'; initGallery(document.getElementById('tile-gallery'));", resolveDir: SITE.pathname },
	bundle: true, format: 'esm', write: false, logLevel: 'silent',
	// the Preview pop-up's tile loader isn't needed here (Preview isn't exercised)
	plugins: [{ name: 'no-loader', setup: (b) => { b.onResolve({ filter: /^@dasl\/tile-loader$/ }, () => ({ path: 'loader', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class TileMothership {} export class Tile {} export const atLoader = null; export default {};' })); } }],
});
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>${globalCss}</style><style>${style}</style></head><body>${main}<script type="module" src="/gallery.js"></script></body></html>`;
const server = createServer((req, res) => {
	if (req.url.startsWith('/gallery.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(bundle.outputFiles[0].text); }
	res.writeHead(200, { 'content-type': 'text/html' }); res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PAGE = `http://127.0.0.1:${server.address().port}/`;

// ---- the stand-in network ----
const A = 'did:plc:burritoburritoburritobur', B = 'did:plc:makermakermakermakermake';
const HANDLES = { [A]: 'busy.test', [B]: 'maker.test' };
const PDS = 'https://pds.test';
let tid = 0;
const rkey = () => `t${String(tid++).padStart(12, '0')}`;
const rec = (did, name, description, hoursAgo, k = null) => ({
	uri: `at://${did}/ing.dasl.masl/${k || rkey()}`, cid: `bafyrei${'c'.repeat(40)}`,
	value: { $type: 'ing.dasl.masl', cid: 'bafyman', tile: { ...(name == null ? {} : { name }), ...(description ? { description } : {}), resources: {} }, createdAt: new Date(Date.now() - hoursAgo * 3600e3).toISOString() },
});
const JOB = (h, k) => rec(A, 'job-status', 'Feature job status snapshot', h, k);
const RECORDS = {
	[A]: [JOB(1, 'job0000000001'), JOB(1.5, 'job0000000002'), JOB(2, 'job0000000003'), JOB(2.5, 'job0000000004'), JOB(3, 'job0000000005'), JOB(3.5, 'job0000000006'),
		rec(A, 'TV Wake Lock Lab', 'v1: first try', 4), rec(A, 'TV Wake Lock Lab', 'v2: screen stays on', 5), rec(A, 'Kiln Notes', '', 6)],
	[B]: [rec(B, 'Lantern', 'A glass lantern', 0.5), rec(B, 'job-status', 'Feature job status snapshot', 7), rec(B, null, '', 8), rec(B, null, '', 9)],
};
const TOTAL = Object.values(RECORDS).flat().length;

const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const json = (route, body, status = 200) => route.fulfill({ status, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(body) });
await ctx.route('https://relay1.us-east.bsky.network/**', (r) => json(r, { repos: [{ did: A }, { did: B }] }));
await ctx.route('https://plc.directory/**', (r) => {
	const did = decodeURIComponent(new URL(r.request().url()).pathname.slice(1));
	return json(r, { id: did, alsoKnownAs: [`at://${HANDLES[did]}`], service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }] });
});
await ctx.route('https://public.api.bsky.app/**', (r) => {
	const h = new URL(r.request().url()).searchParams.get('handle');
	return json(r, { did: Object.keys(HANDLES).find((d) => HANDLES[d] === h) });
});
await ctx.route(`${PDS}/**`, (r) => {
	const u = new URL(r.request().url());
	if (u.pathname.endsWith('listRecords')) return json(r, { records: RECORDS[u.searchParams.get('repo')] || [] });
	return r.fulfill({ status: 404, body: '' });
});
let jet = null;
await ctx.routeWebSocket(/jetstream/, (ws) => { jet = ws; });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

const names = () => page.$$eval('.tg-grid > .tg-card', (cs) => cs.map((c) => c.querySelector('.tg-name').textContent + (c.classList.contains('tg-copy') ? ' (copy)' : '')));
const card = (uri) => page.locator(`.tg-card[data-uri="${uri}"]`);
const until = (fn, arg, ms = 10000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const jobUri = (k) => `at://${A}/ing.dasl.masl/${k}`;

try {
	await page.goto(PAGE);
	await until((n) => document.querySelector('[data-tg="n-tiles"]').textContent === String(n), TOTAL);
	await until(() => document.querySelectorAll('.tg-grid > .tg-card').length >= 7);

	step('repeats show as one card, the newest, with "+5 earlier versions"; the counts still cover every tile');
	let list = await names();
	assert.equal(list.filter((n) => n === 'job-status').length, 2, String(list));         // busy.test's group, and maker.test's own
	assert.equal(await card(jobUri('job0000000001')).locator('.tg-earlier').textContent(), '+5 earlier versions');
	assert.equal(await card(jobUri('job0000000001')).locator('.tg-earlier').getAttribute('aria-expanded'), 'false');
	assert.equal(await page.textContent('[data-tg="n-tiles"]'), String(TOTAL));
	assert.equal(await page.textContent('[data-tg="n-authors"]'), '2');

	step('same name with other descriptions, the same name from another account, and untitled tiles stay as they are');
	assert.equal(list.filter((n) => n === 'TV Wake Lock Lab').length, 2);
	assert.equal(list.filter((n) => n === '(untitled)').length, 2);
	assert.deepEqual(list, ['Lantern', 'job-status', 'TV Wake Lock Lab', 'TV Wake Lock Lab', 'Kiln Notes', 'job-status', '(untitled)', '(untitled)'], 'newest first, a group by its newest');
	assert.equal(await page.locator('.tg-earlier').count(), 1);
	if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/gallery-folded.png` });

	step('the line opens the group in place: the earlier copies right after the card, newest first; "Hide earlier versions"');
	await card(jobUri('job0000000001')).locator('.tg-earlier').click();
	await until(() => document.querySelectorAll('.tg-card.tg-copy').length === 5);
	list = await names();
	assert.deepEqual(list.slice(1, 7), ['job-status', ...Array(5).fill('job-status (copy)')]);
	const copies = await page.$$eval('.tg-card.tg-copy', (cs) => cs.map((c) => c.dataset.uri.split('/').pop()));
	assert.deepEqual(copies, ['job0000000002', 'job0000000003', 'job0000000004', 'job0000000005', 'job0000000006']);
	assert.equal(await card(jobUri('job0000000001')).locator('.tg-earlier').textContent(), 'Hide earlier versions');
	assert.equal(await card(jobUri('job0000000001')).locator('.tg-earlier').getAttribute('aria-expanded'), 'true');
	assert.equal(await page.locator('.tg-card.tg-copy .tg-earlier').count(), 0, 'the copies have no line of their own');
	if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/gallery-opened.png` });
	await card(jobUri('job0000000001')).locator('.tg-earlier').click();
	await until(() => document.querySelectorAll('.tg-card.tg-copy').length === 0);

	step('a tile arriving live joins its group: it becomes the card, the count grows; a deleted card hands over');
	await until(() => true);
	assert.ok(jet, 'the page connected to the live feed');
	const fresh = JOB(0, 'job0000000000');
	jet.send(JSON.stringify({ did: A, time_us: Date.now() * 1000, kind: 'commit', commit: { operation: 'create', collection: 'ing.dasl.masl', rkey: 'job0000000000', cid: fresh.cid, record: fresh.value } }));
	await until((u) => document.querySelector(`.tg-card[data-uri="${u}"] .tg-earlier`)?.textContent === '+6 earlier versions', jobUri('job0000000000'));
	assert.equal(await card(jobUri('job0000000001')).count(), 0, 'the old card folded in');
	assert.equal(await page.textContent('[data-tg="n-tiles"]'), String(TOTAL + 1));
	assert.equal((await names())[0], 'job-status', 'the newest, first');
	jet.send(JSON.stringify({ did: A, time_us: Date.now() * 1000, kind: 'commit', commit: { operation: 'delete', collection: 'ing.dasl.masl', rkey: 'job0000000000' } }));
	await until((u) => document.querySelector(`.tg-card[data-uri="${u}"] .tg-earlier`)?.textContent === '+5 earlier versions', jobUri('job0000000001'));
	assert.equal(await page.textContent('[data-tg="n-tiles"]'), String(TOTAL));

	step('an opened group stays open when a new copy arrives');
	await card(jobUri('job0000000001')).locator('.tg-earlier').click();
	await until(() => document.querySelectorAll('.tg-card.tg-copy').length === 5);
	const fresh2 = JOB(0, 'job000000000a');
	jet.send(JSON.stringify({ did: A, time_us: Date.now() * 1000, kind: 'commit', commit: { operation: 'create', collection: 'ing.dasl.masl', rkey: 'job000000000a', cid: fresh2.cid, record: fresh2.value } }));
	await until(() => document.querySelectorAll('.tg-card.tg-copy').length === 6);
	await card(jobUri('job000000000a')).locator('.tg-earlier').click();
	await until(() => document.querySelectorAll('.tg-card.tg-copy').length === 0);

	step('search shows the group’s card; the author menu keeps the folding');
	await page.fill('[data-tg="search"]', 'snapshot');
	await until(() => document.querySelectorAll('.tg-grid > .tg-card').length === 2);
	assert.equal(await card(jobUri('job000000000a')).locator('.tg-earlier').textContent(), '+6 earlier versions');
	await page.fill('[data-tg="search"]', '');
	await page.selectOption('[data-tg="author"]', A);
	await until(() => document.querySelectorAll('.tg-grid > .tg-card').length === 4);
	assert.deepEqual(await names(), ['job-status', 'TV Wake Lock Lab', 'TV Wake Lock Lab', 'Kiln Notes']);
	await page.selectOption('[data-tg="author"]', '');

	step('sorts place a group by its newest copy');
	await page.selectOption('[data-tg="sort"]', 'old');
	await until(() => document.querySelector('.tg-grid > .tg-card .tg-name')?.textContent === '(untitled)');
	list = await names();
	assert.deepEqual(list.slice(-2), ['Lantern', 'job-status'], 'the group sits where its newest copy does (just now), not its oldest');
	await page.selectOption('[data-tg="sort"]', 'new');

	step('CSV export: every tile, repeats too');
	const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-tg="export"]')]);
	const csv = await readFile(await dl.path(), 'utf8');
	assert.equal(csv.trim().split('\n').length - 1, TOTAL + 1);
	assert.equal(csv.split('\n').filter((l) => l.includes('"job-status"') && l.includes(A)).length, 7);

	step('phone width: no sideways scroll; the line under the card');
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(300);
	assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
	assert.ok(await card(jobUri('job000000000a')).locator('.tg-earlier').isVisible());
	if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/gallery-phone.png` });

	assert.deepEqual(errors, [], 'no errors on the page');
	console.log('\nAll gallery checks passed.');
} catch (e) {
	console.error('\nFAILED:', e.message);
	if (errors.length) console.error('Page errors:', errors);
	process.exitCode = 1;
} finally {
	await browser.close();
	server.close();
}
