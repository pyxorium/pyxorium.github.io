// typeahead.js: handle suggestions under a seat's handle box, the Foundry's typeahead
// (web-tile-foundry src/ui/HandleTypeahead.jsx) without React.
//
// Suggestions come from typeahead.waow.tech (searchActors, up to 6), 150 ms after typing stops, from
// 2 characters. Trade-off (as in the Foundry): what's typed in the box goes to that service. The
// suggestions are only a convenience: choosing one just fills the box; signing in still looks the
// handle up the normal way and goes through the account's own sign-in.
//
// Keyboard: ↓ ↑ move, Enter chooses (without Enter on a suggestion the form submits as usual),
// Escape closes. Mouse: press a suggestion. Everything from the network goes in with textContent,
// and avatars only from Bluesky's picture server (the page's policy allows nothing else).

export const TYPEAHEAD_URL = 'https://typeahead.waow.tech';
export const CLIENT_LABEL = 'thunderbird.cafe';
export const AVATAR_PREFIX = 'https://cdn.bsky.app/';
const LIMIT = 6, WAIT = 150, MIN = 2;

export async function searchActors(text, fetchImpl = fetch, signal) {
  const q = String(text || '').trim().replace(/^@/, '');
  if (q.length < MIN) return [];
  try {
    const res = await fetchImpl(`${TYPEAHEAD_URL}/xrpc/tech.waow.typeahead.searchActors?q=${encodeURIComponent(q)}&limit=${LIMIT}`,
      { headers: { 'X-Client': CLIENT_LABEL }, signal });
    if (!res.ok) return [];
    const body = await res.json();
    return (Array.isArray(body.actors) ? body.actors : [])
      .filter((a) => a && typeof a.handle === 'string' && a.handle && a.handle !== 'handle.invalid')
      .slice(0, LIMIT);
  } catch {
    return [];
  }
}

let count = 0;
export function attachTypeahead(input, { fetchImpl = fetch, skip = () => false } = {}) {
  const id = `su-ta-${++count}`;
  const wrap = document.createElement('span');
  wrap.className = 'su-ta';
  input.replaceWith(wrap);
  wrap.append(input);
  const list = document.createElement('ul');
  list.className = 'su-ta-list';
  list.id = id;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.append(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', id);
  input.setAttribute('aria-expanded', 'false');

  let actors = [], active = -1, timer = null, asked = 0, ac = null;

  const close = () => {
    actors = []; active = -1; list.hidden = true; list.textContent = '';
    input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
  };
  const choose = (i) => {
    const a = actors[i];
    if (!a) return;
    input.value = a.handle;
    close();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    clearTimeout(timer);                 // the filled-in handle doesn't need suggestions of its own
  };
  const mark = () => {
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) input.setAttribute('aria-activedescendant', `${id}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const draw = () => {
    list.textContent = '';
    actors.forEach((a, i) => {
      const li = document.createElement('li');
      li.id = `${id}-${i}`;
      li.setAttribute('role', 'option');
      li.className = 'su-ta-item';
      const pic = document.createElement('span');
      pic.className = 'su-ta-pic';
      if (typeof a.avatar === 'string' && a.avatar.startsWith(AVATAR_PREFIX)) {
        const img = document.createElement('img');
        img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.src = a.avatar;
        pic.append(img);
      }
      const words = document.createElement('span');
      words.className = 'su-ta-words';
      const h = document.createElement('span'); h.className = 'su-ta-handle'; h.textContent = '@' + a.handle;
      words.append(h);
      if (typeof a.displayName === 'string' && a.displayName.trim()) {
        const d = document.createElement('span'); d.className = 'su-ta-name'; d.textContent = a.displayName.trim();
        words.append(d);
      }
      li.append(pic, words);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });   // before the box loses focus
      list.append(li);
    });
    list.hidden = !actors.length;
    input.setAttribute('aria-expanded', String(!!actors.length));
    mark();
  };

  input.addEventListener('input', (e) => {
    if (!e.isTrusted) return;            // our own fill-in
    clearTimeout(timer);
    const text = input.value;
    if (skip() || text.trim().replace(/^@/, '').length < MIN) { close(); return; }
    timer = setTimeout(async () => {
      const mine = ++asked;              // a slow earlier answer never replaces a newer one
      if (ac) ac.abort();
      ac = new AbortController();
      const found = await searchActors(text, fetchImpl, ac.signal);
      if (mine !== asked || document.activeElement !== input) return;
      actors = found; active = -1; draw();
    }, WAIT);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden || !actors.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % actors.length; mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = active <= 0 ? actors.length - 1 : active - 1; mark(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  input.addEventListener('blur', () => { asked++; close(); });
  return { close };
}
