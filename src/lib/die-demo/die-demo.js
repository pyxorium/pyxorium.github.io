// The host page for the shared-die demo (layer 1: tiles, relay, forwarding, status).
//
// It loads both tiles through the real loader (TileMothership), then does what a tile cannot: hold the
// relay connections and pass messages between each tile and its connection. The logic lives in bridge.js.
// The caller decides WHERE the tiles come from (a published record in production, local files in
// development) through `prepare` and `tileUris`, so the same page code is used in both.
import { TileMothership } from '@dasl/tile-loader';
import { createBridge, ROLES } from './bridge.js';
import { createArrows, ARROW_CSS } from './arrows.js';
import { createWirePanel, WIRE_CSS } from './wire-panel.js';

const UP = 'tiles-protocol-up-data-';
const DOWN = 'tiles-protocol-down-data-';

const CSS = `
.die-demo { --text:#eaf0f6; --dim:#8ea0b3; --line:#2a2d33; background:#0a0b0f; color:var(--text);
  border-radius:12px; overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
.die-demo .dd-top { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;
  padding:12px 20px; border-bottom:1px solid var(--line); }
.die-demo .dd-title { font-size:17px; font-weight:600; color:var(--dim); }
.die-demo .dd-status { font-size:13px; color:var(--dim); }
.die-demo .dd-stage { position:relative; display:flex; gap:24px; padding:24px; align-items:flex-start; }
@media (max-width:720px) { .die-demo .dd-stage { flex-direction:column; } }
.die-demo .dd-col { flex:1; min-width:0; width:100%; }
.die-demo .dd-cap { text-align:center; margin-bottom:8px; }
.die-demo .dd-cap-name { font-size:15px; color:var(--dim); font-weight:600; }
.die-demo .dd-cap-sub { font-size:13px; color:#5a6774; margin-top:2px; min-height:1.2em; }
.die-demo .dd-mount { border:1px solid var(--line); border-radius:12px; overflow:hidden; background:#05070d;
  display:flex; align-items:center; justify-content:center; min-height:120px; }
.die-demo .dd-loading { color:#888; font-size:.9rem; padding:24px; }
.die-demo .dd-sr { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
` + ARROW_CSS + WIRE_CSS;

function el(tag, attrs = {}, parent) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); }
  if (parent) parent.appendChild(n);
  return n;
}

export async function mountDieDemo(root, cfg) {
  const { loadDomain, relayUrl, prepare, tileUris, height = 420, captions = {}, debug = false } = cfg;

  if (!document.getElementById('die-demo-css')) el('style', { id: 'die-demo-css', text: CSS }, document.head);
  root.textContent = '';
  const wrap = el('div', { class: 'die-demo' }, root);
  const top = el('div', { class: 'dd-top' }, wrap);
  el('span', { class: 'dd-title', text: 'Shared die' }, top);
  const statusEl = el('span', { class: 'dd-status', 'aria-live': 'polite', text: 'Connecting…' }, top);
  const stage = el('div', { class: 'dd-stage' }, wrap);
  const live = el('div', { class: 'dd-sr', 'aria-live': 'polite', role: 'status' }, wrap);   // announces what the arrows show
  const mounts = {};
  for (const role of ROLES) {
    const col = el('div', { class: 'dd-col' }, stage);
    const cap = el('div', { class: 'dd-cap' }, col);
    el('div', { class: 'dd-cap-name', text: captions[role]?.name ?? (role === 'bob' ? "Bob's tile" : "Alice's tile") }, cap);
    el('div', { class: 'dd-cap-sub', text: captions[role]?.sub ?? '' }, cap);
    mounts[role] = el('div', { class: 'dd-mount' }, col);
    el('p', { class: 'dd-loading', text: 'Loading tile…' }, mounts[role]);
  }
  const track = el('div', { class: 'dd-track', 'aria-hidden': 'true' }, stage);
  const arrows = createArrows({ stage, track, mounts });
  const wirePanel = createWirePanel({ root: wrap, relayUrl });
  const TILE_NAME = { bob: "Bob's tile", alice: "Alice's tile" };

  // One shared mothership for both tiles (two instances would each react to the other's messages).
  const mothership = new TileMothership({ loadDomain });
  mothership.init();
  if (prepare) await prepare(mothership);

  const iframes = { bob: null, alice: null };
  const wireLog = [];
  const counts = { out: {}, in: {} };

  const bridge = createBridge({
    relayUrl,
    toTile: (role, payload) => {
      const f = iframes[role];
      if (f && f.contentWindow) f.contentWindow.postMessage({ action: DOWN + 'payload', payload }, '*');
    },
    onWire: (dir, role, frame) => {
      wirePanel.record(dir, role, frame);
      if (dir === 'out' && frame.t === 'wish') {             // the arrows leave the moment the message is sent
        arrows.wish(role);
        live.textContent = `${TILE_NAME[role]} wished for control.`;
      } else if (dir === 'out' && frame.t === 'grant') {
        arrows.grant(role);
        live.textContent = `${TILE_NAME[role]} passed control to ${TILE_NAME[role === 'bob' ? 'alice' : 'bob']}.`;
      }
      counts[dir][frame.t] = (counts[dir][frame.t] || 0) + 1;
      wireLog.push({ dir, role, t: frame.t, seq: frame.seq, at: Date.now() });
      if (wireLog.length > 300) wireLog.shift();
    },
    onEvent: (e) => {
      if (e.type === 'hello' && e.count > 1) arrows.clearWish();   // a reloaded tile has forgotten any wish
      renderStatus();
    },
  });

  // A message from a tile arrives from its shuttle frame; find which tile by comparing windows.
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || d.action !== UP + 'payload') return;
    const role = ROLES.find((r) => iframes[r] && e.source === iframes[r].contentWindow);
    if (role) bridge.onTileMessage(role, d.payload);
  });

  function renderStatus() {
    const s = bridge.status();
    const word = (r) => ({ live: 'connected', connecting: 'connecting', down: 'reconnecting' }[s[r].state] || s[r].state);
    const rtt = [s.bob.rtt, s.alice.rtt].filter((x) => x !== null);
    const lag = rtt.length ? ` · round trip ${Math.round(rtt.reduce((a, b) => a + b, 0) / rtt.length)} ms` : '';
    statusEl.textContent = `Relay: ${word('bob')} / ${word('alice')}${lag}`;
  }
  const statusTimer = setInterval(renderStatus, 1000);

  async function mountTile(role) {
    const mount = mounts[role];
    let tile = false;
    try { tile = await mothership.loadTile(tileUris[role]); } catch (err) { console.error(`[die-demo] loading ${role}:`, err); }
    if (!tile) { mount.textContent = 'Could not load this tile.'; return; }
    const ifr = tile.renderContent(height);
    ifr.setAttribute('title', role === 'bob' ? "Bob's tile" : "Alice's tile");
    mount.textContent = '';
    mount.appendChild(ifr);
    iframes[role] = ifr;
  }

  bridge.start();                                   // the relay connections do not wait for the tiles
  await Promise.all(ROLES.map(mountTile));
  renderStatus();

  const handle = {
    bridge, mothership, iframes, mounts, wireLog, counts, arrows, wirePanel,
    destroy() { clearInterval(statusTimer); bridge.close(); arrows.destroy(); wirePanel.destroy(); },
  };
  if (debug) window.__host = handle;
  return handle;
}
