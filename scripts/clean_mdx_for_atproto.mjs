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

// Inline code spans MUST be resolved before anything else touches the
// text -- doing JSX-tag removal first (as an earlier version of this
// script did) can partially chew into a backtick-wrapped CODE EXAMPLE
// of JSX syntax (e.g. an illustrative `<WebTile uri="..." />` inside a
// sentence, not live usage), leaving one stray backtick that then
// swallows a large, unrelated later chunk of real text into what the
// next regex pass mistakes for "inline code." Confirmed this failure
// mode directly by testing against the first real post, not assumed --
// see the project notes for what it actually produced before this fix.
function deBacktick(src) {
  return src.replace(/`([^`]+)`/g, '$1');
}

function stripImportsAndJSX(src) {
  return src
    // ESM import lines, e.g. `import WishDemo from '../../components/WishDemo.astro';`
    .replace(/^import .+ from .+;?\s*$/gm, '')
    // self-closing component tags, e.g. `<WishDemo height={640} />`
    .replace(/<[A-Z][A-Za-z0-9]*(\s+[^>]*)?\/>/g, '')
    // paired component tags (opening/closing), e.g. `<Foo>...</Foo>` -- keeps inner text
    .replace(/<\/?[A-Z][A-Za-z0-9]*(\s+[^>]*)?>/g, '');
}

function markdownToPlainText(src) {
  return src
    // headers: "## Title" -> "Title"
    .replace(/^#{1,6}\s+(.+)$/gm, '$1')
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
  const raw = readFileSync(path, 'utf8');
  let body = stripFrontmatter(raw);
  body = deBacktick(body);
  body = stripImportsAndJSX(body);
  body = markdownToPlainText(body);
  return body;
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
