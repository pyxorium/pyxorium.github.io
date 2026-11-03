// Repeats fold into one card (Nov 2026; the Foundry project's claude/raku-recent-repeats.md, G1). Some accounts
// publish the same tile again and again (a status snapshot every half hour, say): the same account, the same name
// and the same description. The gallery shows the newest as the card, with a quiet "+59 earlier versions" line
// that opens the group in place. Raku's Recent tiles uses the same rule (its src/recent.js repeatKey).
//
// Only tiles with a real name fold (two untitled tiles may well be different tiles); spaces are tidied and capitals
// ignored; an empty description on both counts as the same.

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The same tile again? A key shared by repeats, or null for a tile that never folds. */
export function repeatKey(tile) {
	if (!tile || !tile.named || !tile.did) return null;
	const name = norm(tile.name);
	return name ? `${tile.did}\n${name}\n${norm(tile.description)}` : null;
}

/** The quiet line under a folded card, and under an opened one. */
export const earlierLine = (n) => `+${n} earlier version${n === 1 ? '' : 's'}`;
export const HIDE_EARLIER = 'Hide earlier versions';

const time = (t) => t.date?.getTime?.() ?? 0;

/**
 * Tiles into groups: [{ key, head, earlier: [tiles, newest first] }]. The head is the newest of its group (by its
 * date; a tie keeps the later record key). A tile that never folds is a group of one (key null).
 */
export function groupRepeats(tiles) {
	const byKey = new Map();
	const groups = [];
	for (const t of tiles) {
		const k = repeatKey(t);
		if (!k) { groups.push({ key: null, head: t, earlier: [] }); continue; }
		let g = byKey.get(k);
		if (!g) { g = { key: k, members: [] }; byKey.set(k, g); groups.push(g); }
		g.members.push(t);
	}
	return groups.map((g) => {
		if (!g.members) return g;
		const m = g.members.sort((x, y) => time(y) - time(x) || (y.rkey > x.rkey ? 1 : y.rkey < x.rkey ? -1 : 0));
		return { key: g.key, head: m[0], earlier: m.slice(1) };
	});
}
