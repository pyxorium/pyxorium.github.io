#!/usr/bin/env node
/**
 * clean_mdx_for_atproto.mjs
 *
 * Reusable, general-purpose: takes any of this blog's .mdx source
 * files and produces the FULL body as clean plain text -- suitable
 * for patching into a site.standard.document record's `textContent`,
 * matching the style already manually applied to the first post
 * (headers/links rendered to plain prose, no raw import lines or
 * JSX tags left in).
 *
 * This exists because Sequoia's own textContent (when derived from
 * the markdown body, which is what we want -- see the project notes
 * on textContentField, which was considered and deliberately NOT used
 * since it substitutes a short field instead of the full body) does
 * not render or clean the MDX at all -- it's the raw source. Confirmed
 * directly against the live PDS record for the first post before this
 * script was written, not assumed.
 *
 * Deliberately a straightforward regex-based cleaner, not a full MDX/
 * remark AST pipeline -- this blog's posts use a small, consistent
 * set of syntax (frontmatter, one import line, one or two component
 * tags, headers, links, bold/italic, list items). If a future post
 * uses something this doesn't handle (tables, code blocks, nested
 * lists), extend the relevant strip*() function rather than assuming
 * it's covered.
 *
 * USAGE
 * -----
 * node clean_mdx_for_atproto.mjs path/to/post.mdx
 *   -> prints the cleaned full text to stdout
 *
 * node clean_mdx_for_atproto.mjs path/to/post.mdx --patch <rkey>
 *   -> also fetches the current live record for that rkey and PATCHES
 *      its textContent in place (same PDS/putRecord approach as the
 *      original one-off cleanup script for the first post, just
 *      pointed at whatever rkey you give it and fed the programmatically
 *      cleaned text instead of a hand-retyped string).
 */

import { readFileSync } from 'node:fs';

function stripFrontmatter(src) {
  return src.replace(/^---\n[\s\S]*?\n---\n/, '');
}

// Inline code spans are set aside before anything else touches the text
// and put back (without their backticks) at the very end. Doing JSX-tag
// removal first (as an earlier version of this script did) can partially
// chew into a backtick-wrapped CODE EXAMPLE of JSX syntax (e.g. an
// illustrative `<WebTile uri="..." />` inside a sentence, not live usage),
// leaving one stray backtick that swallows a large, unrelated later chunk
// of real text. Simply removing the backticks first (the next version) let
// the JSX pass delete the example itself ("any future post, , to embed"),
// and let the emphasis pass eat asterisks inside code (`blob:*/*` became
// `blob:/:`). Setting the spans aside (Oct 2026) avoids all three.
const CODE_MARK = '\u0000';
function setAsideCode(src, spans) {
  return src.replace(/`([^`\n]+)`/g, (_, code) => {
    spans.push(code);
    return `${CODE_MARK}${spans.length - 1}${CODE_MARK}`;
  });
}
function putBackCode(src, spans) {
  return src.replace(new RegExp(`${CODE_MARK}(\\d+)${CODE_MARK}`, 'g'), (_, i) => spans[Number(i)]);
}

function stripImportsAndJSX(src) {
  return src
    // MDX comments, e.g. `{/* a note for the author */}` (Oct 2026, the Daisy post)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    // ESM import lines, e.g. `import WishDemo from '../../components/WishDemo.astro';`
    .replace(/^import .+ from .+;?\s*$/gm, '')
    // self-closing component tags, e.g. `<WishDemo height={640} />`
    .replace(/<[A-Z][A-Za-z0-9]*(\s+[^>]*)?\/>/g, '')
    // paired component tags (opening/closing), e.g. `<Foo>...</Foo>` -- keeps inner text
    .replace(/<\/?[A-Z][A-Za-z0-9]*(\s+[^>]*)?>/g, '');
}

// Tables (Oct 2026, the Daisy post, the first with a table): each body row becomes a list line,
// "- First cell. Header: cell; header: cell." with an empty cell or a dash as "none", after a line
// naming the columns. Runs before the link and emphasis rules, which then clean the cells.
function tablesToText(src) {
  const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  return src.replace(/^(\|.*\|)\n\|[\s:|-]+\|\n((?:\|.*\|\n?)+)/gm, (_, head, body) => {
    const names = cells(head);
    const label = (n) => n.replace(/\s*\([^)]*\)\s*$/, '');            // "Wish (all addressed)" -> "Wish"
    const rows = body.trim().split('\n').map(cells);
    const plain = (c) => (!c || /^[—–-]$/.test(c) ? 'none' : c);
    const lines = rows.map((r) => `- ${r[0]}. ` + names.slice(1).map((n, i) => `${i ? label(n).toLowerCase() : label(n)}: ${plain(r[i + 1])}`).join('; ') + '.');
    return `Table: ${names.join(', ')}.\n\n${lines.join('\n')}\n`;
  });
}

function markdownToPlainText(src) {
  return tablesToText(src)
    // headers: "## Title" -> "Title"
    .replace(/^#{1,6}\s+(.+)$/gm, '$1')
    // pictures: "![alt](path)" -> "Diagram: alt" (before the link rule, which would leave a stray "!";
    // Oct 2026, the first post with pictures in its body)
    // (an alt text that already starts with "Screenshot" is kept as it is; Oct 2026, the Daisy post)
    .replace(/^!\[([^\]]*)\]\([^)]+\)\s*$/gm, (_, alt) => (!alt.trim() ? '' : /^screenshot\b/i.test(alt.trim()) ? alt.trim() : `Diagram: ${alt.trim()}`))
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // links: "[text](url)" -> "text" (matches the style already used on the first post's live record)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // bold/italic markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    // list markers ("- item") are KEPT as-is -- matches the proven-good
    // live record for the first post, confirmed by direct comparison,
    // not assumed. An earlier version of this script incorrectly
    // stripped them.
    // collapse 3+ blank lines down to 2 (one blank line between paragraphs)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanMdxFile(path) {
  // Windows line endings (CRLF) are made plain first: the patterns below
  // expect "\n", and with CRLF the front matter was left in (Oct 2026).
  const raw = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
  const spans = [];
  let body = stripFrontmatter(raw);
  body = setAsideCode(body, spans);
  body = stripImportsAndJSX(body);
  body = markdownToPlainText(body);
  return putBackCode(body, spans);
}

async function patchRecord(rkey, textContent) {
  const PDS = process.env.SEQUOIA_PDS || 'https://fibercap.us-west.host.bsky.network';
  const IDENTIFIER = process.env.SEQUOIA_IDENTIFIER || 'thunderbird.cafe';
  const APP_PASSWORD = process.env.BSKY_APP_PASSWORD;
  if (!APP_PASSWORD) {
    console.error('Set BSKY_APP_PASSWORD in this terminal first.');
    process.exit(1);
  }

  const sessionRes = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: IDENTIFIER, password: APP_PASSWORD }),
  });
  const session = await sessionRes.json();
  if (!session.accessJwt) throw new Error('Login failed: ' + JSON.stringify(session));
  const { accessJwt, did } = session;

  const getRes = await fetch(`${PDS}/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=site.standard.document&rkey=${rkey}`);
  const current = await getRes.json();
  if (!current.value) throw new Error('Could not fetch current record: ' + JSON.stringify(current));

  const updatedRecord = { ...current.value, textContent };

  const putRes = await fetch(`${PDS}/xrpc/com.atproto.repo.putRecord`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessJwt}` },
    body: JSON.stringify({ repo: did, collection: 'site.standard.document', rkey, record: updatedRecord }),
  });
  const result = await putRes.json();
  console.log('Updated:', JSON.stringify(result, null, 2));
}

const [, , filePath, flag, rkey] = process.argv;
if (!filePath) {
  console.error('Usage: node clean_mdx_for_atproto.mjs path/to/post.mdx [--patch <rkey>]');
  process.exit(1);
}

const cleaned = cleanMdxFile(filePath);

if (flag === '--patch' && rkey) {
  patchRecord(rkey, cleaned).catch(console.error);
} else {
  console.log(cleaned);
}
