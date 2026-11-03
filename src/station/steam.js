// steam.js: soft wisps rise from the mug cursor's rim as it moves, and one drifts up now and then while it rests
// (ST7). Not for people who ask for less motion, and only for a mouse: it follows the pointer's own kind
// (pointerType "mouse"), not the screen's reported kind, which some computers with a mouse get wrong (the owner's
// reported no "fine" pointer, Nov 2). A finger or pen makes none. Over a tile the tile's own cursor shows and the
// page hears no movement, so no steam there either.
const WISP = "<svg viewBox='0 0 12 22' width='12' height='22' aria-hidden='true'><path d='M6 21 C1 16 11 12 6 7 C3 4 7 2 6 1' fill='none' stroke='rgba(243,236,203,.85)' stroke-width='1.6' stroke-linecap='round'/></svg>";

export function startSteam({ win = window, doc = document } = {}) {
  const reduce = win.matchMedia('(prefers-reduced-motion: reduce)');
  let x = -100, y = -100, last = 0;
  const on = () => !reduce.matches;
  function wisp() {
    if (!on() || x < 0) return;
    const w = doc.createElement('div');
    w.className = 'wisp';
    w.innerHTML = WISP;
    // the rim sits a little right of and below the cursor's hotspot
    w.style.left = `${x + 4 + Math.random() * 10}px`;
    w.style.top = `${y - 22}px`;
    w.style.setProperty('--dx', `${Math.random() * 10 - 5}px`);
    doc.body.appendChild(w);
    setTimeout(() => w.remove(), 1700);
    last = performance.now();
  }
  win.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') { x = -100; return; }
    x = e.clientX; y = e.clientY;
    if (performance.now() - last > 120) wisp();
  }, { passive: true });
  doc.addEventListener('mouseleave', () => { x = -100; });
  win.addEventListener('blur', () => { x = -100; });
  setInterval(() => { if (performance.now() - last > 700) wisp(); }, 900);
}
