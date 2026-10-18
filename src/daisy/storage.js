// storage.js: what this browser keeps for a Daisy table, so a reload picks up where it was.
//   localStorage  daisy-table:<table>:<did>  { me, other, snapshot, savedAt }   (a day)
//   sessionStorage daisy-tab:<table>          the account this tab sits as
// The snapshot is this seat's house state, with its secret seed: it stays in this browser. Every read
// and write is guarded (private windows and blocked storage just mean no resuming).
import { KEEP_PREFIX, TAB_PREFIX, TIMES } from './config.js';

const safe = (f, fallback = null) => { try { return f(); } catch { return fallback; } };

export function keep(table, entry, now = Date.now()) {
  safe(() => localStorage.setItem(`${KEEP_PREFIX}${table}:${entry.me.did}`, JSON.stringify({ ...entry, savedAt: now })));
  safe(() => sessionStorage.setItem(`${TAB_PREFIX}${table}`, entry.me.did));
}
export function kept(table, now = Date.now()) {
  const out = [];
  safe(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(`${KEEP_PREFIX}${table}:`)) continue;
      const v = JSON.parse(localStorage.getItem(k));
      if (v && v.me && now - v.savedAt < TIMES.keepFor) out.push(v);
    }
  });
  return out;
}
export const tabAccount = (table) => safe(() => sessionStorage.getItem(`${TAB_PREFIX}${table}`));
export function forgetOld(now = Date.now()) {
  safe(() => {
    const gone = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(KEEP_PREFIX)) continue;
      const v = safe(() => JSON.parse(localStorage.getItem(k)));
      if (!v || !(now - v.savedAt < TIMES.keepFor)) gone.push(k);
    }
    gone.forEach((k) => localStorage.removeItem(k));
  });
}

// The unfinished matches this browser keeps for an account (Oct 18): for the start screen's "You have a
// match in progress with @x. Back to the table". Newest first; only tables with another player and a
// match that isn't over (as far as this browser knows: a forfeit claimed while it was away shows once the
// table is opened again).
export function inProgress(did, now = Date.now()) {
  const out = [];
  safe(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(KEEP_PREFIX) || !k.endsWith(`:${did}`)) continue;
      const v = safe(() => JSON.parse(localStorage.getItem(k)));
      if (!v || !v.me || v.me.did !== did || !(now - v.savedAt < TIMES.keepFor) || !v.other || !v.other.handle) continue;
      const phase = v.snapshot && v.snapshot.shared && v.snapshot.shared.phase;
      if (phase === 'over' || phase === 'abandoned') continue;
      out.push({ table: k.slice(KEEP_PREFIX.length, k.length - did.length - 1), with: v.other.handle, savedAt: v.savedAt });
    }
  });
  return out.sort((a, b) => b.savedAt - a.savedAt);
}
