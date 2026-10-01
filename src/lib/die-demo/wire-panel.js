// "What the relay sees": a live table of the frames this page sends to and receives from the relay, and a
// button that really tries to send the relay a message, on its own throwaway connection, and shows the
// relay's own refusal.
//
// Honest about what it shows: the table is the frames THIS PAGE sends and receives, which is also what the
// relay sees from these connections. The relay also sees your internet address, when frames arrive, and the
// random session number for this page load. The relay program stores nothing and logs no messages.
//
// The refusal test uses its OWN connection, never one of the two seats, because the relay closes a
// connection after five bad frames and two bad frames here must not be able to disturb the demo.

export const WIRE_CSS = `
.die-demo .dd-wire { border-top:1px solid var(--line); padding:0 20px; }
.die-demo .dd-wire > summary { cursor:pointer; padding:12px 0; font-size:14px; color:var(--dim); font-weight:600; }
.die-demo .dd-wire-body { padding:0 0 18px; font-size:13px; color:var(--dim); line-height:1.5; }
.die-demo .dd-wire-note { margin:0 0 12px; max-width:70ch; }
.die-demo .dd-wire-scroll { overflow-x:auto; }
.die-demo .dd-wire-table { border-collapse:collapse; width:100%; font-size:12px; }
.die-demo .dd-wire-table th { text-align:left; font-weight:600; color:#6b7a8a; padding:4px 10px 4px 0; border-bottom:1px solid var(--line); white-space:nowrap; }
.die-demo .dd-wire-table td { padding:4px 10px 4px 0; vertical-align:top; border-bottom:1px solid #1c1f25; }
.die-demo .dd-wire-table td.num { text-align:right; font-variant-numeric:tabular-nums; }
.die-demo .dd-wire-table code { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11.5px; color:#b9c6d3; word-break:break-all; }
.die-demo .dd-wire-empty { color:#6b7a8a; font-style:italic; }
.die-demo .dd-wire-try { margin-top:16px; }
.die-demo .dd-wire-btn { appearance:none; border:1px solid #3a3d44; background:#1a1c22; color:var(--text); padding:8px 14px;
  border-radius:8px; cursor:pointer; font-size:13px; }
.die-demo .dd-wire-btn:hover:not(:disabled) { background:#24272e; }
.die-demo .dd-wire-btn:disabled { opacity:.6; cursor:default; }
.die-demo .dd-wire-btn:focus-visible { outline:2px solid #6fb3ff; outline-offset:2px; }
.die-demo .dd-wire-out { margin-top:10px; }
.die-demo .dd-wire-out p { margin:0 0 4px; }
.die-demo .dd-wire-out code { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11.5px; color:#b9c6d3; word-break:break-all; }
.die-demo .dd-wire-out .ok { color:#99ffbb; }
.die-demo .dd-wire-out .bad { color:#ff9a9a; }
`;

const KIND_ORDER = ['join', 'joined', 'peer', 'wish', 'grant', 'scheme', 'motion', 'ping', 'pong', 'err'];
const SEAT_NAME = { bob: "Bob's tile", alice: "Alice's tile" };

// The two things the relay must refuse: a message with words in it, and a valid frame with one extra word.
export const REFUSAL_PROBES = [
  { t: 'chat', text: 'hello' },
  { t: 'motion', seq: 1, rx: 0, ry: 0, z: 8, vx: 0, vy: 0, note: 'hello' },
];

const short = (obj, n = 130) => { const s = JSON.stringify(obj); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function el(tag, attrs = {}, parent) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); }
  if (parent) parent.appendChild(n);
  return n;
}

export function createWirePanel({ root, relayUrl, WebSocketImpl = null, renderEveryMs = 250, answerTimeoutMs = 8000 }) {
  const details = el('details', { class: 'dd-wire' }, root);
  el('summary', { text: 'What the relay sees' }, details);
  const body = el('div', { class: 'dd-wire-body' }, details);
  el('p', { class: 'dd-wire-note', text: 'Below is every kind of frame this page sends to the relay and receives from it, with the latest one of each kind. All of it is numbers and colours: the relay rejects anything else, and you can test that with the button. The relay also sees your internet address, when frames arrive, and the random session number for this page load. The relay program itself stores nothing and logs no messages.' }, body);
  const scroll = el('div', { class: 'dd-wire-scroll' }, body);
  const table = el('table', { class: 'dd-wire-table' }, scroll);
  const head = el('tr', {}, el('thead', {}, table));
  for (const h of ['Tile', 'Direction', 'Kind', 'Count', 'Latest frame']) el('th', { text: h }, head);
  const tbody = el('tbody', {}, table);
  const empty = el('p', { class: 'dd-wire-empty', text: 'Nothing yet.' }, body);

  const rows = new Map();                       // "role|dir|kind" -> { role, dir, kind, count, latest }
  let timer = null, destroyed = false;

  function render() {
    timer = null;
    if (destroyed) return;
    tbody.textContent = '';
    const list = [...rows.values()].sort((a, b) =>
      (a.role === b.role ? 0 : a.role === 'bob' ? -1 : 1) || (a.dir === b.dir ? 0 : a.dir === 'out' ? -1 : 1) ||
      (KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)));
    empty.style.display = list.length ? 'none' : 'block';
    for (const r of list) {
      const tr = el('tr', {}, tbody);
      el('td', { text: SEAT_NAME[r.role] }, tr);
      el('td', { text: r.dir === 'out' ? 'sent up to the relay' : 'came down from the relay' }, tr);
      el('td', { text: r.kind }, tr);
      el('td', { class: 'num', text: String(r.count) }, tr);
      el('code', { text: short(r.latest) }, el('td', {}, tr));
    }
  }

  // One frame on the wire. Rendering is throttled: motion alone is about sixteen frames a second.
  function record(dir, role, frame) {
    if (!frame || typeof frame.t !== 'string') return;
    const key = `${role}|${dir}|${frame.t}`;
    const row = rows.get(key) || { role, dir, kind: frame.t, count: 0, latest: null };
    row.count += 1; row.latest = frame; rows.set(key, row);
    if (!timer && !destroyed) timer = setTimeout(render, renderEveryMs);
  }

  // Really try to send the relay words, on a connection of its own, and show what it answers.
  const out = el('div', { class: 'dd-wire-out', 'aria-live': 'polite' });
  const tryBox = el('div', { class: 'dd-wire-try' }, body);
  const btn = el('button', { class: 'dd-wire-btn', type: 'button', text: 'Try to send the relay a message' }, tryBox);
  tryBox.appendChild(out);

  function line(parent, cls, label, frame) {
    const p = el('p', cls ? { class: cls } : {}, parent);
    p.appendChild(document.createTextNode(label + ' '));
    el('code', { text: typeof frame === 'string' ? frame : short(frame, 200) }, p);
    return p;
  }

  async function tryToSend() {
    btn.disabled = true; out.textContent = '';
    el('p', { text: 'Opening a separate connection to the relay…' }, out);
    const result = await new Promise((resolve) => {
      const answers = [];
      let ws, settled = false, step = 0;
      const finish = (r) => { if (settled) return; settled = true; clearTimeout(deadline); try { ws && ws.close(); } catch { /* already closed */ } resolve(r); };
      const deadline = setTimeout(() => finish({ error: 'The relay did not answer in time.', answers }), answerTimeoutMs);
      try { ws = new (WebSocketImpl || globalThis.WebSocket)(relayUrl); } catch (e) { finish({ error: 'Could not reach the relay.', answers }); return; }
      ws.onopen = () => ws.send(JSON.stringify(REFUSAL_PROBES[0]));
      ws.onmessage = (ev) => {
        let f; try { f = JSON.parse(ev.data); } catch { f = String(ev.data); }
        answers.push(f);
        step += 1;
        if (step < REFUSAL_PROBES.length) ws.send(JSON.stringify(REFUSAL_PROBES[step]));
        else finish({ answers });
      };
      ws.onerror = () => finish({ error: 'Could not reach the relay.', answers });
      ws.onclose = () => finish({ error: answers.length ? null : 'The relay closed the connection without answering.', answers });
    });
    out.textContent = '';
    REFUSAL_PROBES.forEach((probe, i) => {
      const ans = result.answers[i];
      if (ans === undefined) return;
      line(out, '', 'Sent:', probe);
      const rejected = ans && ans.t === 'err' && ans.code === 'bad_frame';
      line(out, rejected ? 'ok' : 'bad', 'Relay answered:', ans);
      el('p', { class: rejected ? 'ok' : 'bad', text: rejected ? 'Rejected, and not passed on to anyone.' : 'Unexpected answer.' }, out);
    });
    if (result.error) el('p', { class: 'bad', text: result.error }, out);
    btn.disabled = false;
  }
  btn.addEventListener('click', tryToSend);

  return {
    record, tryToSend, details,
    rows: () => [...rows.values()].map((r) => ({ role: r.role, dir: r.dir, kind: r.kind, count: r.count })),
    flush: render,
    destroy() { destroyed = true; clearTimeout(timer); },
  };
}
