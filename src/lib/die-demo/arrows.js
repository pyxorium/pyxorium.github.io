// The W and G arrows that fly between the two tiles (shapes and colours from Demo #1; the C arrow is not used).
//
//   * A wish departs the moment the wish is sent. The W arrow flies to the tile that holds control and RESTS
//     at its near edge until the grant.
//   * A grant departs the moment the grant is sent: the W arrow clears, and the G arrow flies to the tile that
//     receives control, then fades out.
//
// Flight takes a fixed 0.7 s. The message itself is not held back: it crosses the relay in about 50 ms, and
// the arrow is a cue, not a measurement. The die trailing slightly behind shows the real lag.
// Arrows are decoration (aria-hidden); the host page announces what happened in a visually hidden live region.
// Layout is checked once per arrow: side by side, or stacked on narrow screens (Bob above Alice).
// With reduced motion, arrows appear where they belong without flying.

const COLORS = { W: '#6fb3ff', G: '#ffaa50' };
const POLYGON = '10,44 76,44 76,20 118,64 76,108 76,84 10,84';     // the Demo #1 arrow
const other = (role) => (role === 'bob' ? 'alice' : 'bob');

export const ARROW_CSS = `
.die-demo .dd-track { position:absolute; top:0; left:0; right:0; bottom:0; pointer-events:none; z-index:5; }
.die-demo .dd-packet { position:absolute; width:56px; height:56px; transform:translate(-50%,-50%); opacity:0;
  transition:left .7s ease-in-out, top .7s ease-in-out, opacity .25s ease; }
.die-demo .dd-packet.visible { opacity:1; }
.die-demo .dd-packet.fading { opacity:0; transition:opacity .5s ease; }
.die-demo .dd-packet svg { width:100%; height:100%; display:block; transition:transform .2s ease; }
.die-demo .dd-packet.dir-left svg { transform:scaleX(-1); }
.die-demo .dd-packet.dir-down svg { transform:rotate(90deg); }
.die-demo .dd-packet.dir-up svg { transform:rotate(-90deg); }
`;

export function createArrows({ stage, track, mounts, matchMedia = (q) => window.matchMedia(q), flightMs = 700, fadeMs = 500, restMs = 350 }) {
  let w = null, g = null, destroyed = false;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!destroyed) fn(); }, ms); timers.add(t); };

  function arrowSvg(color) {
    return `<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polygon points="${POLYGON}" fill="${color}"/></svg>`;
  }

  // Fly an arrow from one tile's near edge to the other's. Returns the record of it.
  function travel(kind, from, to) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stacked = matchMedia('(max-width: 720px)').matches;
    const el = document.createElement('div');
    el.className = 'dd-packet';
    el.dataset.kind = kind; el.dataset.from = from; el.dataset.to = to; el.dataset.state = 'flying';
    el.setAttribute('aria-hidden', 'true');
    el.style.transition = 'none';
    el.innerHTML = arrowSvg(COLORS[kind]);
    track.appendChild(el);

    const s = stage.getBoundingClientRect(), f = mounts[from].getBoundingClientRect(), t = mounts[to].getBoundingClientRect();
    const bobIsFirst = mounts.bob.getBoundingClientRect()[stacked ? 'top' : 'left'] <= mounts.alice.getBoundingClientRect()[stacked ? 'top' : 'left'];
    const forward = (from === 'bob') === bobIsFirst;           // moving towards the later tile in reading order
    let axis, start, end, orient;
    if (stacked) {
      axis = 'top'; el.style.left = '50%';
      start = forward ? f.bottom - s.top : f.top - s.top;
      end = forward ? t.top - s.top : t.bottom - s.top;
      orient = forward ? 'down' : 'up';
    } else {
      axis = 'left'; el.style.top = '50%';
      start = forward ? f.right - s.left : f.left - s.left;
      end = forward ? t.left - s.left : t.right - s.left;
      orient = forward ? 'right' : 'left';
    }
    el.classList.add('dir-' + orient);                          // 'dir-right' matches no rule: the unrotated default
    el.dataset.dir = orient;
    el.style[axis] = (reduced ? end : start) + 'px';
    el.getBoundingClientRect();                                  // flush, so the start position is applied first
    if (!reduced) el.style.transition = '';
    requestAnimationFrame(() => { el.classList.add('visible'); el.style[axis] = end + 'px'; });
    // "Arrived" means the arrow has been MEASURED at its destination. It does not mean a timer ran out, and it does
    // not mean the browser sent a "movement finished" event: on a slow or busy machine the movement can start
    // late, and an event or a timer can then claim arrival while the arrow is still at its start (seen in testing
    // on a machine drawing everything in software). So we check where the arrow is, every 60 ms, and if it is
    // still not there after a generous deadline we put it there.
    const rec = { el, kind, from, to, arrived: false, arrivedAt: null, waiting: [] };
    rec.arrive = () => {
      if (rec.arrived) return;
      rec.arrived = true; rec.arrivedAt = Date.now(); el.dataset.state = 'resting';
      rec.waiting.splice(0).forEach((fn) => fn());
    };
    rec.whenArrived = (fn) => { if (rec.arrived) fn(); else rec.waiting.push(fn); };
    const there = () => {
      const r = el.getBoundingClientRect(), st = stage.getBoundingClientRect();
      const pos = axis === 'left' ? r.left + r.width / 2 - st.left : r.top + r.height / 2 - st.top;
      return Math.abs(pos - end) <= 2;
    };
    if (reduced) rec.arrive();
    else {
      const poll = setInterval(() => { if (destroyed || rec.arrived) clearInterval(poll); else if (there()) { clearInterval(poll); rec.arrive(); } }, 60);
      timers.add(poll);
      later(() => {
        clearInterval(poll);
        if (rec.arrived) return;
        el.style.transition = 'none'; el.style[axis] = end + 'px'; el.classList.add('visible');
        rec.arrive();
      }, flightMs + 2000);
    }
    return rec;
  }

  function remove(rec) { if (rec && rec.el.parentNode) rec.el.remove(); }

  return {
    // The wish was sent by `from`: the W arrow flies to the other tile and rests there.
    wish(from) { remove(w); w = travel('W', from, other(from)); },
    // The grant was sent by `from`: the W arrow clears, the G arrow flies to the other tile, then fades.
    grant(from) {
      remove(w); w = null; remove(g);
      const rec = g = travel('G', from, other(from));
      rec.whenArrived(() => later(() => {                        // rest a moment after landing, then fade
        rec.el.dataset.state = 'fading'; rec.el.classList.add('fading');
        later(() => { remove(rec); if (g === rec) g = null; }, fadeMs);
      }, restMs));
    },
    // A tile was reloaded, so whatever wish was pending is gone.
    clearWish() { remove(w); w = null; },
    state() {
      const d = (rec) => rec && { kind: rec.kind, from: rec.from, to: rec.to, state: rec.el.dataset.state, dir: rec.el.dataset.dir };
      return { w: d(w), g: d(g) };
    },
    destroy() { destroyed = true; timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); remove(w); remove(g); },
  };
}
