// sprite-host.js -- the host page's half of the Cosmic Junkyard tile demo.
//
// A tile can't reach the network, so when its player taps "Load my RPG
// actor sprite", this code does the work on the tile's behalf: it shows an
// inline handle search below the tile, looks up the chosen account's
// actor.rpg.sprite record, fetches the sprite sheet image, and sends it
// down into the tile. This is a host-native capability, not a wish: no
// second tile is involved. Message shapes: rpg-sprite-wish-demo-project.md,
// section 0.
//
// No framework or loader dependencies, so the same file runs in the blog
// post (CosmicJunkyardDemo.astro, through the real tile loader) and in the
// local test harness (test-harness.html, through a plain iframe). The
// caller supplies `sendToTile` and forwards the tile's messages to
// `handleTileMessage`.
//
// The lookup chain is the one House Dice already uses (fetchSprite in
// main.jsx): handle -> DID (bsky.social), DID -> PDS (plc.directory or
// did:web), getRecord actor.rpg.sprite/self, then sync.getBlob for the image.

const TYPEAHEAD_URL = "https://typeahead.waow.tech";
const HANDLE_RESOLVER = "https://bsky.social";
const MAX_SPRITE_BYTES = 1024 * 1024; // real rpg.actor sheets are around 12KB
const SEARCH_DEBOUNCE_MS = 150;

// ---------------------------------------------------------------------
// atproto lookups
// ---------------------------------------------------------------------
async function resolveHandleToDid(handle, fetchImpl) {
  const res = await fetchImpl(`${HANDLE_RESOLVER}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
  if (!res.ok) throw new LookupError("not-found", `Couldn't find @${handle}.`);
  const data = await res.json();
  if (!data.did) throw new LookupError("not-found", `Couldn't find @${handle}.`);
  return data.did;
}

async function resolvePdsEndpoint(did, fetchImpl) {
  let docUrl;
  if (did.startsWith("did:plc:")) docUrl = `https://plc.directory/${encodeURIComponent(did)}`;
  else if (did.startsWith("did:web:")) docUrl = `https://${did.slice("did:web:".length)}/.well-known/did.json`;
  else throw new LookupError("error", "That account uses an identity type this demo doesn't support.");
  const res = await fetchImpl(docUrl);
  if (!res.ok) throw new LookupError("error", "Couldn't look up that account's server.");
  const doc = await res.json();
  const pds = (doc.service || []).find((s) => s.type === "AtprotoPersonalDataServer");
  if (!pds || typeof pds.serviceEndpoint !== "string" || !pds.serviceEndpoint.startsWith("https://")) {
    throw new LookupError("error", "Couldn't look up that account's server.");
  }
  return pds.serviceEndpoint.replace(/\/+$/, "");
}

class LookupError extends Error {
  constructor(state, message) { super(message); this.state = state; }
}

// Returns { blob, frameWidth, frameHeight, sheetWidth, sheetHeight },
// or throws LookupError with state "no-sprite" / "not-found" / "error".
async function fetchSpriteForHandle(handle, fetchImpl) {
  const did = await resolveHandleToDid(handle, fetchImpl);
  const pds = await resolvePdsEndpoint(did, fetchImpl);

  const recordUrl = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=actor.rpg.sprite&rkey=self`;
  const recordRes = await fetchImpl(recordUrl);
  if (!recordRes.ok) throw new LookupError("no-sprite", `@${handle} doesn't have an RPG actor sprite yet.`);
  const record = await recordRes.json();
  const v = record.value || {};
  const cid = v.spriteSheet && v.spriteSheet.ref && v.spriteSheet.ref.$link;
  if (!cid) throw new LookupError("no-sprite", `@${handle} doesn't have an RPG actor sprite yet.`);

  const blobUrl = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
  const blobRes = await fetchImpl(blobUrl);
  if (!blobRes.ok) throw new LookupError("error", "Found the sprite record, but its image wouldn't download.");
  const blob = await blobRes.blob();
  if (blob.type && !blob.type.startsWith("image/")) throw new LookupError("error", "That sprite isn't an image.");
  if (blob.size > MAX_SPRITE_BYTES) throw new LookupError("error", "That sprite image is too large for this demo.");

  return {
    blob,
    frameWidth: v.frameWidth || 48,
    frameHeight: v.frameHeight || 48,
    sheetWidth: v.width || 144,
    sheetHeight: v.height || 192,
  };
}

async function searchActors(query, fetchImpl, signal) {
  const q = query.trim().replace(/^@/, "");
  if (q.length < 2) return [];
  try {
    const res = await fetchImpl(
      `${TYPEAHEAD_URL}/xrpc/tech.waow.typeahead.searchActors?q=${encodeURIComponent(q)}&limit=6`,
      { headers: { "X-Client": "thunderbird.cafe" }, signal }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.actors) ? data.actors : [];
  } catch {
    return [];
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function cleanHandle(text) {
  return text.trim().replace(/^@/, "").toLowerCase();
}
// Loose shape check only: the real test is whether it resolves.
function looksLikeHandle(text) {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(text);
}

// ---------------------------------------------------------------------
// The host: inline panel + tile messaging
// ---------------------------------------------------------------------
export function createSpriteHost({ panelMount, sendToTile, imageFormat = "blob", fetchImpl }) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let loadedSprite = null;   // the last sprite sent, re-sent if the tile says hello again
  let busy = false;
  let searchTimer = null;
  let searchAbort = null;
  let suggestions = [];
  let highlighted = -1;

  // --- build the panel (hidden until the tile asks for it) ---
  const panel = document.createElement("div");
  panel.className = "cj-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="cj-panel-head">
      <label class="cj-label" for="">Load your RPG actor sprite into the game</label>
      <button type="button" class="cj-close" aria-label="Close">✕</button>
    </div>
    <div class="cj-search">
      <input class="cj-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
             placeholder="yourhandle.bsky.social" role="combobox" aria-autocomplete="list" aria-expanded="false" />
      <button type="button" class="cj-go">Load</button>
      <ul class="cj-suggestions" role="listbox" hidden></ul>
    </div>
    <div class="cj-message" aria-live="polite"></div>
    <div class="cj-credit">Handle search powered by <a href="https://typeahead.waow.tech" target="_blank" rel="noopener">typeahead.waow.tech</a>.
      No sprite yet? Make one at <a href="https://rpg.actor/" target="_blank" rel="noopener">rpg.actor</a>.</div>
  `;
  panelMount.appendChild(panel);

  const input = panel.querySelector(".cj-input");
  const goBtn = panel.querySelector(".cj-go");
  const closeBtn = panel.querySelector(".cj-close");
  const list = panel.querySelector(".cj-suggestions");
  const message = panel.querySelector(".cj-message");
  const inputId = "cj-input-" + Math.random().toString(36).slice(2, 8);
  input.id = inputId;
  panel.querySelector(".cj-label").setAttribute("for", inputId);
  list.id = inputId + "-list";
  input.setAttribute("aria-controls", list.id);

  function setMessage(text, tone) {
    message.textContent = text || "";
    message.dataset.tone = tone || "";
  }

  // --- typeahead ---
  function closeSuggestions() {
    suggestions = [];
    highlighted = -1;
    list.innerHTML = "";
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }

  function renderSuggestions() {
    list.innerHTML = "";
    suggestions.forEach((actor, i) => {
      const li = document.createElement("li");
      li.className = "cj-suggestion" + (i === highlighted ? " cj-active" : "");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", i === highlighted ? "true" : "false");
      if (typeof actor.avatar === "string" && actor.avatar.startsWith("https://")) {
        const img = document.createElement("img");
        img.src = actor.avatar;
        img.alt = "";
        img.className = "cj-avatar";
        img.referrerPolicy = "no-referrer";
        li.appendChild(img);
      } else {
        const blank = document.createElement("span");
        blank.className = "cj-avatar cj-avatar-blank";
        li.appendChild(blank);
      }
      const text = document.createElement("span");
      text.className = "cj-suggestion-text";
      const h = document.createElement("span");
      h.className = "cj-suggestion-handle";
      h.textContent = "@" + actor.handle;
      text.appendChild(h);
      if (actor.displayName) {
        const d = document.createElement("span");
        d.className = "cj-suggestion-name";
        d.textContent = actor.displayName;
        text.appendChild(d);
      }
      li.appendChild(text);
      // mousedown, not click, so it fires before the input loses focus
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(actor.handle);
      });
      list.appendChild(li);
    });
    list.hidden = suggestions.length === 0;
    input.setAttribute("aria-expanded", suggestions.length ? "true" : "false");
  }

  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    if (searchAbort) searchAbort.abort();
    setMessage("");
    const query = input.value;
    if (query.trim().replace(/^@/, "").length < 2) { closeSuggestions(); return; }
    searchTimer = setTimeout(async () => {
      const controller = new AbortController();
      searchAbort = controller;
      const results = await searchActors(query, doFetch, controller.signal);
      if (controller.signal.aborted || input.value !== query) return; // a newer keystroke won
      suggestions = results.filter((a) => a && typeof a.handle === "string").slice(0, 6);
      highlighted = -1;
      renderSuggestions();
    }, SEARCH_DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && suggestions.length) {
      highlighted = (highlighted + 1) % suggestions.length;
      renderSuggestions();
      e.preventDefault();
    } else if (e.key === "ArrowUp" && suggestions.length) {
      highlighted = (highlighted - 1 + suggestions.length) % suggestions.length;
      renderSuggestions();
      e.preventDefault();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlighted >= 0 && suggestions[highlighted]) choose(suggestions[highlighted].handle);
      else choose(input.value);
    } else if (e.key === "Escape") {
      if (!list.hidden) closeSuggestions();
      else cancel();
    }
  });
  input.addEventListener("blur", () => setTimeout(closeSuggestions, 100));
  goBtn.addEventListener("click", () => choose(input.value));
  closeBtn.addEventListener("click", cancel);

  // --- the actual load ---
  async function choose(rawHandle) {
    if (busy) return;
    const handle = cleanHandle(rawHandle);
    clearTimeout(searchTimer);              // a search still waiting to fire shouldn't reopen the list
    if (searchAbort) searchAbort.abort();
    closeSuggestions();
    if (!looksLikeHandle(handle)) {
      setMessage("Enter a full handle, like yourname.bsky.social.", "warn");
      return;
    }
    input.value = handle;
    busy = true;
    goBtn.disabled = true;
    input.disabled = true;
    setMessage(`Looking up @${handle}…`);
    sendToTile({ kind: "sprite-status", state: "loading" });
    try {
      const sprite = await fetchSpriteForHandle(handle, doFetch);
      const image = imageFormat === "dataurl" ? await blobToDataUrl(sprite.blob) : sprite.blob;
      loadedSprite = {
        kind: "sprite", v: 1, handle, image,
        frameWidth: sprite.frameWidth, frameHeight: sprite.frameHeight,
        sheetWidth: sprite.sheetWidth, sheetHeight: sprite.sheetHeight,
      };
      sendToTile(loadedSprite);
      setMessage(`Loaded @${handle}'s sprite. Have fun!`, "ok");
      setTimeout(() => { if (!busy) hidePanel(); }, 1800);
    } catch (err) {
      const state = err instanceof LookupError ? err.state : "error";
      // the tile has no "not-found" status; it just keeps its current character
      sendToTile({ kind: "sprite-status", state: state === "not-found" ? "error" : state });
      setMessage(err instanceof LookupError ? err.message : "Something went wrong loading that sprite.", "warn");
    } finally {
      busy = false;
      goBtn.disabled = false;
      input.disabled = false;
    }
  }

  function showPanel() {
    panel.hidden = false;
    setMessage("");
    input.focus({ preventScroll: true });
    panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function hidePanel() {
    panel.hidden = true;
    closeSuggestions();
  }
  function cancel() {
    if (busy) return;
    hidePanel();
    sendToTile({ kind: "sprite-status", state: "cancelled" });
  }

  // --- messages from the tile ---
  function handleTileMessage(payload) {
    if (!payload || typeof payload !== "object" || typeof payload.kind !== "string") return;
    if (payload.kind === "hello") {
      // First start, or the tile reloaded: give it the sprite again if
      // there is one, otherwise just let it know a host is here.
      sendToTile(loadedSprite || { kind: "sprite-status", state: "ready" });
    } else if (payload.kind === "sprite-request") {
      showPanel();
      sendToTile({ kind: "sprite-status", state: "searching" });
    }
  }

  return { handleTileMessage };
}
