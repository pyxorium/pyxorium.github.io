// Small shared helpers for the tile gallery.

export function esc(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

export async function getJSON(url) {
	const r = await fetch(url);
	const j = await r.json().catch(() => ({}));
	if (!r.ok) throw new Error(j.message || j.error || `HTTP ${r.status}`);
	return j;
}

// Run `fn` over `items` with at most `n` in flight.
export async function pool(items, n, fn) {
	const queue = [...items];
	const workers = Array.from({ length: Math.min(n, queue.length) }, async () => {
		while (queue.length) await fn(queue.shift());
	});
	await Promise.all(workers);
}

// Record keys are TIDs: 13 base32-sortable chars whose top 53 bits are
// microseconds since the Unix epoch. Used when a record has no createdAt.
export function tidToDate(rkey) {
	const A = '234567abcdefghijklmnopqrstuvwxyz';
	if (!/^[2-7a-z]{13}$/.test(rkey)) return null;
	let v = 0n;
	for (const ch of rkey) v = v * 32n + BigInt(A.indexOf(ch));
	const ms = Number((v >> 10n) / 1000n);
	return ms > 946684800000 && ms < Date.now() + 864e5 ? new Date(ms) : null;
}

export function fmtDate(d) {
	return d ? d.toISOString().slice(0, 10) : 'unknown';
}

export function fmtBytes(n) {
	if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB';
	if (n > 1e3) return Math.round(n / 1e3) + ' KB';
	return n + ' B';
}
