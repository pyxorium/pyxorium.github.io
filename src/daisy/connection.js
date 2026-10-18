// connection.js: the page's connection to the relay (a WebSocket). It joins the table, passes the
// house's messages to the other page, and comes back by itself after a drop (0.5 s, then longer, up to
// 8 s). Messages sent while it's down wait in a short queue; anything lost on the way is asked for
// again by the houses themselves (each message carries a sequence number).
export function connectRelay({ url, joinMessage, onMessage, onState = () => {}, WebSocketImpl = globalThis.WebSocket }) {
  let ws = null, stopped = false, joined = false, delay = 500, timer = null;
  const queue = [];
  function open() {
    if (stopped) return;
    onState('connecting');
    try { ws = new WebSocketImpl(url); } catch { return retry(); }
    ws.onopen = () => { delay = 500; ws.send(JSON.stringify(joinMessage())); };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (!m || typeof m.type !== 'string') return;
      if (m.type === 'joined') { joined = true; onState('joined'); while (queue.length) send(queue.shift()); }
      if (m.type === 'full' || m.type === 'replaced' || m.type === 'held') stopped = true;
      onMessage(m);
    };
    ws.onclose = () => { joined = false; ws = null; if (!stopped) { onState('down'); retry(); } };
    ws.onerror = () => {};
  }
  function retry() {
    clearTimeout(timer);
    timer = setTimeout(open, delay);
    delay = Math.min(delay * 2, 8000);
  }
  function send(data) {
    if (joined && ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'send', data }));
    else if (queue.length < 500) queue.push(data);
  }
  open();
  return {
    send,
    stop() { stopped = true; clearTimeout(timer); if (ws) ws.close(); },
    // For the checks: drop the connection as a network blip would (it comes back by itself).
    blip() { if (ws) ws.close(); },
  };
}
