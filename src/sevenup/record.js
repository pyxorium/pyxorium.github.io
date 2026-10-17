// COPY of sevenup-tiles/harness/record.js (tested there: npm test). Edit it there, then run
// node scripts/copy-to-site.mjs <site folder> to bring it here.

// record.js: turns the house's result into the record one player saves
// (cafe.thunderbird.sevenup.match, one per player in their own account, record key = match id),
// and checks a record against the lexicon (lexicons/cafe.thunderbird.sevenup.match.json) before saving.

export const COLLECTION = 'cafe.thunderbird.sevenup.match';
export const STYLE_IDS = ['bone', 'casino', 'jade', 'midnight', 'glow', 'brick'];

// house: { uri, cid } of the published house tile, or null while it isn't published (then left out).
export function recordFor(result, seat, house, createdAt = new Date().toISOString()) {
  if (seat !== 1 && seat !== 2) throw new Error('seat must be 1 or 2');
  const record = {
    $type: COLLECTION,
    matchId: result.matchId,
    seat,
    players: result.players.map((p) => ({ did: p.did, handle: p.handle, diceStyle: p.diceStyle, ...(p.bot ? { bot: true } : {}) })),
    firstPlayer: result.firstPlayer,
    rounds: result.rounds.map((r) => ({ player: r.player, rolls: r.rolls.map((d) => [d[0], d[1]]) })),
    handoffs: [...result.handoffs],
    summary: result.summary.map((s) => ({ longest: s.longest, quickest: s.quickest, specials: s.specials })),
    createdAt,
  };
  if (house && typeof house.uri === 'string' && house.uri.startsWith('at://') && typeof house.cid === 'string') {
    record.house = { uri: house.uri, cid: house.cid };
  }
  return record;
}

// The other player, for the save prompt's "This record mentions @x".
export function otherPlayer(result, seat) {
  return result.players[seat === 1 ? 1 : 0];
}

// The record key: a match id is a TID (see the house's newId): 13 base32-sortable characters, the
// first one 2 to j. (Matches saved before Oct 17 2026 have random 13-character keys; they stay as they are.)
export const isRecordKey = (k) => typeof k === 'string' && /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/.test(k);

// Returns null when the record matches the lexicon, else what's wrong.
export function checkRecord(r) {
  const int = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!r || r.$type !== COLLECTION) return '$type';
  if (!isRecordKey(r.matchId)) return 'matchId';
  if (!int(r.seat, 1, 2)) return 'seat';
  if (!Array.isArray(r.players) || r.players.length !== 2) return 'players';
  for (const p of r.players) {
    if (!p || typeof p.did !== 'string' || !/^did:[a-z]+:[A-Za-z0-9._:%-]+$/.test(p.did)) return 'player did';
    if (typeof p.handle !== 'string' || p.handle.length > 253 || !p.handle.includes('.')) return 'player handle';
    if (!STYLE_IDS.includes(p.diceStyle)) return 'player diceStyle';
    if ('bot' in p && p.bot !== true) return 'player bot';
  }
  if (r.players[r.seat - 1].bot) return 'a bot seat does not save';
  if (!int(r.firstPlayer, 1, 2)) return 'firstPlayer';
  if (!Array.isArray(r.rounds) || r.rounds.length !== 6) return 'rounds';
  for (const round of r.rounds) {
    if (!round || !int(round.player, 1, 2) || !Array.isArray(round.rolls) || round.rolls.length < 1 || round.rolls.length > 10000) return 'round';
    if (!round.rolls.every((d) => Array.isArray(d) && d.length === 2 && d.every((n) => int(n, 1, 6)))) return 'rolls';
  }
  if (!Array.isArray(r.handoffs) || r.handoffs.length > 5 || !r.handoffs.every((h) => h === 'granted' || h === 'auto')) return 'handoffs';
  if (!Array.isArray(r.summary) || r.summary.length !== 2 || !r.summary.every((s) => s && int(s.longest, 0, 10000) && int(s.quickest, 0, 10000) && int(s.specials, 0, 10000))) return 'summary';
  if (typeof r.createdAt !== 'string' || Number.isNaN(Date.parse(r.createdAt))) return 'createdAt';
  if ('house' in r && !(r.house && typeof r.house.uri === 'string' && r.house.uri.startsWith('at://') && typeof r.house.cid === 'string')) return 'house';
  return null;
}
