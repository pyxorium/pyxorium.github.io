// at-tags: which atproto records a page corresponds to, as <meta name="at:…"> tags in its head
// (https://tangled.org/chrisshank.me/at-tags). Four properties, each a list (the tag repeats):
//   at:canonical  the record the page IS (if it were deleted, the page would cease to exist)
//   at:alternate  records the page refers to (the publication, the tiles and other records it shows)
//   at:author     who wrote the page, as an AT URI of a DID
//   at:me         who owns the site, as an AT URI of a DID (on every page, from BaseHead.astro)
// Always the DID form. Decisions AT1 to AT9: claude/at-tags-and-linking-notes.md in the Foundry project.
// Checked by test/at-tags.test.mjs (node --test test/at-tags.test.mjs).

// thunderbird.cafe: the site, the blog posts and their standard.site publication.
export const SITE_DID = 'did:plc:6vxjigxrqizmbo56gojxico3';
export const SITE_ME = `at://${SITE_DID}`;
// The same address as public/.well-known/site.standard.publication.
export const PUBLICATION = `at://${SITE_DID}/site.standard.publication/3mwhy6xsszo27`;

// An AT URI naming one record by DID: at://did:plc:…/collection/rkey (no handles, no query or fragment).
const RECORD_URI = /^at:\/\/did:(?:plc:[a-z2-7]{24}|web:[A-Za-z0-9.%-]+(?::[A-Za-z0-9.%-]+)*)\/[a-zA-Z][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9-]+){2,}\/[A-Za-z0-9._:~-]{1,512}$/;

export function isRecordUri(value) {
	return typeof value === 'string' && RECORD_URI.test(value);
}

// Tiles a post embeds: <WebTile uri="at://…"> and <CosmicJunkyardDemo uri="at://…">, read from the post's own text.
// Code (fenced blocks and inline code) is skipped, so examples such as `<WebTile uri="..." />` never count, and so
// is anything that isn't a full DID-form record address (placeholders like at://…).
const EMBED = /<(?:WebTile|CosmicJunkyardDemo)\b[^>]*?\suri=["'](at:\/\/[^"']+)["']/g;

export function embeddedRecords(body = '') {
	const text = String(body)
		.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '')
		.replace(/`[^`\n]*`/g, '');
	const found = [];
	for (const m of text.matchAll(EMBED)) if (isRecordUri(m[1])) found.push(m[1]);
	return found;
}

function unique(list) {
	return [...new Set(list)];
}

// An address given by hand must be a record address in the DID form: a mistake stops the build rather than
// quietly emitting a wrong tag.
function checked(list, field, where) {
	for (const uri of list) {
		if (!isRecordUri(uri)) {
			throw new Error(`at-tags: ${where}: ${field} needs DID-form record addresses (at://did:…/collection/rkey), got ${JSON.stringify(uri)}`);
		}
	}
	return list;
}

// The tags for one blog post, from its front matter, its text and its extras (AT_ALTERNATES in
// src/lib/at-alternates.js). No atUri yet (a new post before its Sequoia publish): no canonical, no standard.site
// link, no publication.
export function postAtTags({ id = 'a post', atUri, bobAtUri, aliceAtUri, body = '', extra = [] } = {}) {
	const published = atUri != null && atUri !== '';
	if (published) checked([atUri], 'atUri', id);
	const wishes = [bobAtUri, aliceAtUri].filter((u) => u != null && u !== '');
	checked(wishes, 'bobAtUri/aliceAtUri', id);
	checked(extra, 'AT_ALTERNATES', id);
	const canonical = published ? [atUri] : [];
	const alternate = unique([
		...(published ? [PUBLICATION] : []),
		...embeddedRecords(body),
		...wishes,
		...extra,
	]).filter((u) => !canonical.includes(u));
	return { canonical, document: published ? atUri : null, alternate, author: [SITE_ME] };
}

// The at:alternate list for a page that shows a fixed set of records (Seven-Up, Daisy, Station). Entries that
// aren't published yet (null) are left out.
export function pageAlternates(list, where = 'a page') {
	return unique(checked(list.filter((u) => u != null && u !== ''), 'records', where));
}
