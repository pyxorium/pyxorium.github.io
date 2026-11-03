// The gallery's repeats (src/lib/tile-gallery/repeats.js; the Foundry project's claude/raku-recent-repeats.md, G1).
// Run with: node --test test/gallery/*.test.mjs   (plain Node, nothing to install)
import test from 'node:test';
import assert from 'node:assert/strict';
import { repeatKey, groupRepeats, earlierLine, HIDE_EARLIER } from '../../src/lib/tile-gallery/repeats.js';
import { normalize } from '../../src/lib/tile-gallery/normalize.js';

const A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const T = (did, rkey, name, description, hoursAgo, named = true) => ({ uri: `at://${did}/ing.dasl.masl/${rkey}`, did, rkey, name, description, named, date: new Date(Date.UTC(2026, 10, 2, 12) - hoursAgo * 3600e3) });

test('the same tile again: same account, name and description (spaces tidied, capitals ignored)', () => {
	assert.equal(repeatKey(T(A, 'a', 'job-status', 'Feature job status snapshot', 1)), repeatKey(T(A, 'b', ' Job-Status', 'feature  job status snapshot', 2)));
	assert.notEqual(repeatKey(T(A, 'a', 'TV Wake Lock Lab', 'v1', 1)), repeatKey(T(A, 'b', 'TV Wake Lock Lab', 'v2', 2)), 'a different description: not a repeat');
	assert.notEqual(repeatKey(T(A, 'a', 'x', '', 1)), repeatKey(T(B, 'b', 'x', '', 1)), 'another account');
	assert.equal(repeatKey(T(A, 'a', '(untitled)', '', 1, false)), null, 'untitled tiles never fold');
	assert.equal(repeatKey(null), null);
});

test('normalize says whether a tile has a real name', () => {
	const n = (value) => normalize('ing.dasl.masl', A, '3abcdefghijkl', 'bafyrec', value, null);
	assert.equal(n({ tile: { name: 'job-status', resources: {} } }).named, true);
	assert.equal(n({ tile: { name: '  ', resources: {} } }).named, false);
	assert.equal(n({ tile: { resources: {} } }).named, false);
	assert.equal(n({ tile: { resources: {} } }).name, '(untitled)');
});

test('groups: the newest is the card, the earlier copies newest first; others are groups of one', () => {
	const tiles = [
		T(A, 's3', 'job-status', 'Feature job status snapshot', 3), T(B, 'l1', 'Lantern', '', 2), T(A, 's1', 'job-status', 'Feature job status snapshot', 1),
		T(A, 'u1', '(untitled)', '', 5, false), T(A, 'u2', '(untitled)', '', 6, false), T(A, 's2', 'job-status', 'Feature job status snapshot', 2),
	];
	const g = groupRepeats(tiles);
	assert.deepEqual(g.map((x) => [x.head.rkey, x.earlier.map((t) => t.rkey)]), [['s1', ['s2', 's3']], ['l1', []], ['u1', []], ['u2', []]]);
	assert.equal(earlierLine(1), '+1 earlier version');
	assert.equal(earlierLine(59), '+59 earlier versions');
	assert.equal(HIDE_EARLIER, 'Hide earlier versions');
});
