// Tileman, version 3: each tape plays as one continuous "side". When a tape
// with several tracks is saved, its tracks are joined end to end into a single
// file (see mp3join.js), so the audio never stops between songs, which keeps
// Android playing with the screen off. Next/previous become jumps within the
// side. Tapes whose tracks don't match are kept as separate tracks.

(function () {
  "use strict";

  var TAPE_CACHE = "tileman-tapes";
  var INDEX_URL = abs("tapes/index.json");
  var LOG_KEY = "tileman-log";
  var POS_KEY = "tileman-pos";
  var LAST_KEY = "tileman-last";

  var $ = function (id) { return document.getElementById(id); };
  var audio = $("audio");

  var tapes = [];          // what's saved on this phone
  var tape = null;         // the open tape
  var idx = 0;             // the current track
  var urls = {};           // separate-track mode: track number -> blob: URL
  var sideUrl = null;      // side mode: blob: URL of the joined side
  var artUrls = {};        // tape id -> blob: URL of its artwork
  var pendingSeek = null;  // where to start once the audio has loaded (seconds in the file)
  var quietPause = false;  // a pause we've already logged ourselves
  var leaving = false;     // the page is closing; stop recording anything

  function abs(rel) { return new URL(rel, location.href).href; }
  function trackKey(t, n) { return abs("tapes/" + t.id + "/t" + n); }
  function sideKey(t) { return abs("tapes/" + t.id + "/side"); }
  function artKey(t) { return abs("tapes/" + t.id + "/art"); }
  function isSide() { return !!(tape && tape.side); }

  // ---------- test log (kept across restarts) ----------

  function readLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch (e) { return []; }
  }
  function log(msg) {
    var lines = readLog();
    lines.push(new Date().toTimeString().slice(0, 8) + "  " + msg);
    if (lines.length > 300) lines = lines.slice(-300);
    try { localStorage.setItem(LOG_KEY, JSON.stringify(lines)); } catch (e) {}
    $("log").textContent = lines.join("\n");
    $("log").scrollTop = $("log").scrollHeight;
  }
  $("log").textContent = readLog().join("\n");
  $("clearLog").addEventListener("click", function () {
    try { localStorage.removeItem(LOG_KEY); } catch (e) {}
    $("log").textContent = "";
  });
  function screenNote() { return document.hidden ? " (screen off)" : ""; }

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function dur(ms) {
    var s = Math.round(ms / 1000);
    return Math.floor(s / 60) + "m " + (s % 60) + "s";
  }

  // ---------- online / offline ----------

  function showNet() {
    var on = navigator.onLine;
    $("net").textContent = on ? "online" : "offline";
    $("net").classList.toggle("off", !on);
  }
  window.addEventListener("online", function () { showNet(); log("network: online"); });
  window.addEventListener("offline", function () { showNet(); log("network: offline"); });
  showNet();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function (e) {
      log("offline support failed to start: " + e.message);
    });
  }

  // ---------- where we are in the current track ----------

  // Position within the current track, in seconds.
  function trackTime() {
    return isSide() ? audio.currentTime - tape.side.starts[idx] : audio.currentTime;
  }
  function trackLength() {
    return isSide() ? tape.side.durations[idx] : audio.duration;
  }
  function trackAt(t) {
    var s = tape.side.starts, i = 0;
    while (i + 1 < s.length && t >= s[i + 1] - 0.05) i++;
    return i;
  }

  // ---------- how the last session ended ----------

  (function () {
    try {
      var last = JSON.parse(localStorage.getItem(LAST_KEY) || "null");
      if (last && last.playing) {
        log("last session was playing: " + (last.track || "") + " at " + fmt(last.pos) +
            ", last saved " + new Date(last.at).toTimeString().slice(0, 8) +
            " (the app was closed or stopped after that)");
      }
    } catch (e) {}
  })();

  function savePosition() {
    if (!tape) return;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ tapeId: tape.id, idx: idx, time: trackTime() || 0 }));
      localStorage.setItem(LAST_KEY, JSON.stringify({
        playing: !audio.paused, pos: trackTime() || 0, at: Date.now(),
        track: tape.title + " #" + (idx + 1)
      }));
    } catch (e) {}
  }
  function readPosition() {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || "null"); } catch (e) { return null; }
  }

  // ---------- storage ----------

  function openCache() { return caches.open(TAPE_CACHE); }

  function saveIndex() {
    return openCache().then(function (c) {
      return c.put(INDEX_URL, new Response(JSON.stringify(tapes), { headers: { "Content-Type": "application/json" } }));
    });
  }

  function loadIndex() {
    return openCache().then(function (c) {
      return c.match(INDEX_URL).then(function (r) { return r ? r.json() : []; })
        .then(function (list) { tapes = list; return migrateV1(c); });
    });
  }

  // Version 1 kept one tape at tape/info.json, tape/audio, tape/art.
  function migrateV1(c) {
    var old = { info: abs("tape/info.json"), audio: abs("tape/audio"), art: abs("tape/art") };
    return Promise.all([c.match(old.info), c.match(old.audio), c.match(old.art)]).then(function (r) {
      if (!r[0] || !r[1]) return;
      return r[0].json().then(function (info) {
        var t = {
          id: idFor(info.uri), uri: info.uri, title: info.title, artist: info.artist || "",
          art: !!r[2], artType: info.artType || null, savedAt: info.savedAt,
          tracks: [{ title: info.title, artist: info.artist || "", type: info.audioType || "audio/mpeg", size: info.size || 0 }]
        };
        var puts = [c.put(trackKey(t, 0), r[1])];
        if (r[2]) puts.push(c.put(artKey(t), r[2]));
        return Promise.all(puts).then(function () {
          tapes = tapes.filter(function (x) { return x.id !== t.id; }).concat([t]);
          return saveIndex();
        }).then(function () {
          return Promise.all([c.delete(old.info), c.delete(old.audio), c.delete(old.art)]);
        }).then(function () { log("moved \"" + t.title + "\" over from Tileman version 1"); });
      });
    });
  }

  function idFor(uri) {
    var m = /^at:\/\/([^/]+)\/[^/]+\/([^/]+)$/.exec(uri) || [];
    var did = (m[1] || "x").replace(/[^a-z0-9]/gi, "");
    return did.slice(-6) + "-" + (m[2] || String(Date.now())).replace(/[^a-z0-9]/gi, "");
  }

  // ---------- joining tracks into a side ----------

  // blobs: one Blob per track. Resolves to { blob, side } or { error }.
  function tryJoin(blobs) {
    if (blobs.length < 2 || !window.Mp3Join) return Promise.resolve({ error: "only one track" });
    return Promise.all(blobs.map(function (b) { return b.arrayBuffer(); })).then(function (bufs) {
      try {
        var j = Mp3Join.join(bufs.map(function (b) { return new Uint8Array(b); }));
        return {
          blob: new Blob([j.bytes], { type: "audio/mpeg" }),
          side: { starts: j.starts, durations: j.durations, total: j.total, format: j.format }
        };
      } catch (e) {
        return { error: e.message };
      }
    });
  }

  // Tapes saved by version 2 have separate tracks; join them the first time they're opened.
  function joinSavedTape(t) {
    if (t.side || t.split || t.tracks.length < 2) return Promise.resolve();
    return openCache().then(function (c) {
      return Promise.all(t.tracks.map(function (_, i) { return c.match(trackKey(t, i)); })).then(function (rs) {
        if (rs.some(function (r) { return !r; })) return;
        return Promise.all(rs.map(function (r) { return r.blob(); })).then(tryJoin).then(function (res) {
          if (res.error) {
            t.split = res.error;
            log("kept \"" + t.title + "\" as separate tracks: " + res.error);
            return saveIndex();
          }
          return c.put(sideKey(t), new Response(res.blob, { headers: { "Content-Type": "audio/mpeg" } }))
            .then(function () {
              t.side = res.side;
              return saveIndex();
            }).then(function () {
              return Promise.all(t.tracks.map(function (_, i) { return c.delete(trackKey(t, i)); }));
            }).then(function () {
              log("joined \"" + t.title + "\" into one side (" + t.tracks.length + " tracks, " + fmt(res.side.total) + ")");
            });
        });
      });
    });
  }

  // ---------- artwork ----------

  // Artwork is read straight from the phone's storage, so it shows even while
  // an older offline helper is still in charge after an update.
  function artFor(t) {
    if (!t.art) return Promise.resolve("icon-192.png");
    if (artUrls[t.id]) return Promise.resolve(artUrls[t.id]);
    return openCache().then(function (c) { return c.match(artKey(t)); }).then(function (r) {
      if (!r) return "icon-192.png";
      return r.blob().then(function (b) { artUrls[t.id] = URL.createObjectURL(b); return artUrls[t.id]; });
    }).catch(function () { return "icon-192.png"; });
  }

  // ---------- shelf ----------

  function renderShelf() {
    var ul = $("tapes");
    ul.innerHTML = "";
    $("noTapes").classList.toggle("hidden", tapes.length > 0);
    tapes.forEach(function (t) {
      var li = document.createElement("li");
      li.tabIndex = 0;
      var img = document.createElement("img");
      img.className = "thumb"; img.alt = "";
      artFor(t).then(function (u) { img.src = u; });
      var text = document.createElement("div");
      text.className = "li-text";
      var title = document.createElement("div");
      title.className = "li-title"; title.textContent = t.title;
      var sub = document.createElement("div");
      sub.className = "li-sub";
      sub.textContent = t.tracks.length + (t.tracks.length === 1 ? " track" : " tracks") +
        (t.side ? " · " + fmt(t.side.total) : "") + (t.artist ? " · " + t.artist : "");
      text.appendChild(title); text.appendChild(sub);
      li.appendChild(img); li.appendChild(text);
      li.addEventListener("click", function () { openTape(t.id); });
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") openTape(t.id); });
      ul.appendChild(li);
    });
  }

  function show(which) {
    $("shelf").classList.toggle("hidden", which !== "shelf");
    $("add").classList.toggle("hidden", which !== "add");
    $("player").classList.toggle("hidden", which !== "player");
  }

  $("showAdd").addEventListener("click", function () {
    $("addMsg").textContent = ""; $("addMsg").classList.remove("error");
    show("add"); $("addr").focus();
  });
  $("cancelAdd").addEventListener("click", function () { show("shelf"); });
  $("backBtn").addEventListener("click", function () { renderShelf(); show("shelf"); });

  // ---------- reading a tile from the network ----------

  function parseAtUri(s) {
    var m = /^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)$/.exec(s.trim());
    if (!m) throw new Error("That doesn't look like an at:// tile address.");
    return { repo: m[1], collection: m[2], rkey: m[3] };
  }
  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("Request failed (" + r.status + ")");
      return r.json();
    });
  }
  function resolveDid(repo) {
    if (repo.indexOf("did:") === 0) return Promise.resolve(repo);
    return getJson("https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=" +
                   encodeURIComponent(repo)).then(function (j) { return j.did; });
  }
  function findPds(did) {
    var url;
    if (did.indexOf("did:plc:") === 0) url = "https://plc.directory/" + did;
    else if (did.indexOf("did:web:") === 0) url = "https://" + did.slice(8) + "/.well-known/did.json";
    else return Promise.reject(new Error("Unsupported account type: " + did));
    return getJson(url).then(function (doc) {
      var svc = (doc.service || []).filter(function (s) { return s.id === "#atproto_pds"; })[0];
      if (!svc) throw new Error("Couldn't find this account's server.");
      return svc.serviceEndpoint.replace(/\/$/, "");
    });
  }
  function download(url, label) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("Download failed (" + res.status + ")");
      var total = Number(res.headers.get("content-length")) || 0;
      if (!res.body || !res.body.getReader) return res.blob();
      var reader = res.body.getReader(), chunks = [], got = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return new Blob(chunks);
          chunks.push(r.value); got += r.value.length;
          $("addMsg").textContent = "Downloading " + label + "… " +
            (total ? Math.floor(got / total * 100) + "%" : (got / 1048576).toFixed(1) + " MB");
          return pump();
        });
      }
      return pump();
    });
  }

  // Check a file against its content address (CIDv1, raw, sha2-256).
  function b32(bytes) {
    var a = "abcdefghijklmnopqrstuvwxyz234567", out = "", bits = 0, v = 0;
    for (var i = 0; i < bytes.length; i++) {
      v = (v << 8) | bytes[i]; bits += 8;
      while (bits >= 5) { out += a[(v >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += a[(v << (5 - bits)) & 31];
    return out;
  }
  function checkCid(blob, expected, label) {
    if (!(window.crypto && crypto.subtle)) return Promise.resolve(blob);
    return blob.arrayBuffer().then(function (buf) { return crypto.subtle.digest("SHA-256", buf); })
      .then(function (hash) {
        var bytes = new Uint8Array(36);
        bytes.set([0x01, 0x55, 0x12, 0x20]); bytes.set(new Uint8Array(hash), 4);
        if ("b" + b32(bytes) !== expected) throw new Error(label + " didn't match its address.");
        return blob;
      });
  }

  function addTape() {
    var btn = $("addBtn");
    btn.disabled = true;
    $("addMsg").classList.remove("error");
    $("addMsg").textContent = "Looking up the tile…";
    var target, did, pds, tile, res, plan, art, artistLine = $("artistIn").value.trim();

    function blobUrl(r) {
      return pds + "/xrpc/com.atproto.sync.getBlob?did=" + encodeURIComponent(did) +
        "&cid=" + encodeURIComponent(r.src.ref.$link);
    }

    Promise.resolve().then(function () {
      target = parseAtUri($("addr").value);
      return resolveDid(target.repo);
    }).then(function (d) {
      did = d; return findPds(did);
    }).then(function (p) {
      pds = p;
      return getJson(pds + "/xrpc/com.atproto.repo.getRecord?repo=" + encodeURIComponent(did) +
        "&collection=" + encodeURIComponent(target.collection) + "&rkey=" + encodeURIComponent(target.rkey));
    }).then(function (rec) {
      tile = rec.value && rec.value.tile;
      if (!tile || !tile.resources) throw new Error("That record isn't a Web Tile.");
      res = tile.resources;

      // A tape.json, if the tile has one, gives the order and the titles.
      if (res["/tape.json"]) {
        return download(blobUrl(res["/tape.json"]), "the track list")
          .then(function (b) { return checkCid(b, res["/tape.json"].src.ref.$link, "The track list"); })
          .then(function (b) { return b.text(); })
          .then(function (txt) {
            var tj = JSON.parse(txt);
            return {
              title: tj.title || tile.name, artist: tj.artist || "",
              tracks: (tj.tracks || []).filter(function (t) { return res[t.path]; }).map(function (t) {
                return { path: t.path, title: t.title || t.path, artist: t.artist || "" };
              })
            };
          });
      }
      var paths = Object.keys(res).filter(function (k) {
        return String(res[k]["content-type"] || "").indexOf("audio/") === 0;
      }).sort();
      return {
        title: tile.name || "Untitled", artist: "",
        tracks: paths.map(function (p) {
          var name = paths.length === 1 ? (tile.name || p) : p.split("/").pop().replace(/\.[^.]+$/, "");
          return { path: p, title: name, artist: "" };
        })
      };
    }).then(function (pl) {
      plan = pl;
      if (!plan.tracks.length) throw new Error("This tile has no songs in it.");
      var artPath = (tile.icons && tile.icons[0] && tile.icons[0].src) ||
                    (tile.screenshots && tile.screenshots[0] && tile.screenshots[0].src);
      art = artPath && res[artPath] ? res[artPath] : null;

      var blobs = [];
      return plan.tracks.reduce(function (p, t, i) {
        return p.then(function () {
          var label = plan.tracks.length > 1 ? "track " + (i + 1) + " of " + plan.tracks.length : "the song";
          return download(blobUrl(res[t.path]), label)
            .then(function (b) { return checkCid(b, res[t.path].src.ref.$link, "Track " + (i + 1)); })
            .then(function (b) { blobs.push(b); });
        });
      }, Promise.resolve()).then(function () {
        if (!art) return null;
        return download(blobUrl(art), "the artwork").then(function (b) { return checkCid(b, art.src.ref.$link, "The artwork"); });
      }).then(function (artBlob) { return { tracks: blobs, art: artBlob }; });
    }).then(function (got) {
      $("addMsg").textContent = got.tracks.length > 1 ? "Joining the tracks into one side…" : "Saving to this phone…";
      return tryJoin(got.tracks).then(function (joined) {
        got.joined = joined;
        return got;
      });
    }).then(function (got) {
      $("addMsg").textContent = "Saving to this phone…";
      var uri = "at://" + did + "/" + target.collection + "/" + target.rkey;
      var t = {
        id: idFor(uri), uri: uri,
        title: plan.title,
        artist: artistLine || plan.artist,
        art: !!got.art, artType: art ? art["content-type"] : null,
        savedAt: new Date().toISOString(),
        tracks: plan.tracks.map(function (tr, i) {
          return {
            title: tr.title,
            artist: tr.artist || artistLine || plan.artist,
            type: res[tr.path]["content-type"],
            size: got.tracks[i].size
          };
        })
      };
      if (got.joined.side) t.side = got.joined.side;
      else if (got.tracks.length > 1) t.split = got.joined.error;

      // Clear out any earlier copy of this tape first.
      var old = tapes.filter(function (x) { return x.id === t.id; })[0];
      return openCache().then(function (c) {
        var clear = old ? removeFiles(c, old) : Promise.resolve();
        return clear.then(function () {
          var puts = [];
          if (t.side) {
            puts.push(c.put(sideKey(t), new Response(got.joined.blob, { headers: { "Content-Type": "audio/mpeg" } })));
          } else {
            got.tracks.forEach(function (b, i) {
              puts.push(c.put(trackKey(t, i), new Response(b, { headers: { "Content-Type": t.tracks[i].type } })));
            });
          }
          if (got.art) puts.push(c.put(artKey(t), new Response(got.art, { headers: { "Content-Type": t.artType } })));
          return Promise.all(puts);
        });
      }).then(function () {
        if (artUrls[t.id]) { URL.revokeObjectURL(artUrls[t.id]); delete artUrls[t.id]; }
        if (tape && tape.id === t.id) { closeTape(); }
        tapes = tapes.filter(function (x) { return x.id !== t.id; }).concat([t]);
        return saveIndex().then(function () {
          var mb = t.tracks.reduce(function (s, x) { return s + x.size; }, 0) / 1048576;
          log((old ? "updated" : "saved") + " \"" + t.title + "\" (" + t.tracks.length +
              (t.tracks.length === 1 ? " track, " : " tracks, ") + mb.toFixed(1) + " MB)");
          if (t.side) log("joined into one side: " + fmt(t.side.total) + ", " + t.side.format);
          else if (t.split) log("kept as separate tracks: " + t.split);
          return t;
        });
      });
    }).then(function (t) {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then(function (ok) {
          if (!ok) log("persistent storage not granted; the phone may clear tapes if space runs low");
        });
      }
      $("addMsg").textContent = "";
      $("addr").value = ""; $("artistIn").value = "";
      return openTape(t.id);
    }).catch(function (e) {
      $("addMsg").classList.add("error");
      $("addMsg").textContent = e.message;
      log("add failed: " + e.message);
    }).then(function () { btn.disabled = false; });
  }
  $("addBtn").addEventListener("click", addTape);

  function removeFiles(c, t) {
    var dels = t.tracks.map(function (_, i) { return c.delete(trackKey(t, i)); });
    dels.push(c.delete(sideKey(t)), c.delete(artKey(t)));
    return Promise.all(dels);
  }

  // ---------- opening a tape ----------

  function clearUrls() {
    Object.keys(urls).forEach(function (k) { URL.revokeObjectURL(urls[k]); });
    urls = {};
    if (sideUrl) { URL.revokeObjectURL(sideUrl); sideUrl = null; }
  }

  function closeTape() {
    audio.pause();
    audio.removeAttribute("src"); audio.load();
    clearUrls();
    tape = null;
  }

  function getTrackUrl(n) {
    if (urls[n]) return Promise.resolve(urls[n]);
    var t = tape;
    return openCache().then(function (c) { return c.match(trackKey(t, n)); }).then(function (r) {
      if (!r) throw new Error("track " + (n + 1) + " is missing from the phone");
      return r.blob();
    }).then(function (b) {
      if (tape !== t) throw new Error("tape changed");
      urls[n] = URL.createObjectURL(b);
      return urls[n];
    });
  }

  function getSideUrl() {
    if (sideUrl) return Promise.resolve(sideUrl);
    var t = tape;
    return openCache().then(function (c) { return c.match(sideKey(t)); }).then(function (r) {
      if (!r) throw new Error("the side is missing from the phone");
      return r.blob();
    }).then(function (b) {
      if (tape !== t) throw new Error("tape changed");
      sideUrl = URL.createObjectURL(b);
      return sideUrl;
    });
  }

  // Separate-track mode: keep the current and next track ready; let go of the rest.
  function prune() {
    Object.keys(urls).forEach(function (k) {
      var n = Number(k);
      if (n !== idx && n !== idx + 1) { URL.revokeObjectURL(urls[k]); delete urls[k]; }
    });
  }

  function openTape(id) {
    var t = tapes.filter(function (x) { return x.id === id; })[0];
    if (!t) return Promise.resolve();
    if (tape && tape.id === t.id) { show("player"); return Promise.resolve(); }
    if (tape && !audio.paused) {
      log("paused track " + (idx + 1) + " of \"" + tape.title + "\" at " + fmt(trackTime()) + " to switch tapes");
      quietPause = true;
    }
    closeTape();
    return joinSavedTape(t).then(function () {
      tape = t;
      var pos = readPosition();
      var startIdx = 0, startTime = 0;
      if (pos && pos.tapeId === t.id && pos.idx < t.tracks.length) { startIdx = pos.idx; startTime = pos.time || 0; }
      $("tapeTitle").textContent = t.title;
      artFor(t).then(function (u) { $("art").src = u; });
      renderTracks();
      show("player");
      return loadTrack(startIdx, startTime, false).then(function () {
        if (startIdx || startTime > 1) log("opened \"" + t.title + "\" at track " + (startIdx + 1) + ", " + fmt(startTime));
      });
    });
  }

  function renderTracks() {
    var ul = $("tracks");
    ul.innerHTML = "";
    tape.tracks.forEach(function (tr, i) {
      var li = document.createElement("li");
      li.tabIndex = 0;
      var n = document.createElement("span"); n.className = "num"; n.textContent = i + 1;
      var text = document.createElement("div"); text.className = "li-text";
      var title = document.createElement("div"); title.className = "li-title"; title.textContent = tr.title;
      text.appendChild(title);
      var subText = [tr.artist, tape.side ? fmt(tape.side.durations[i]) : ""].filter(Boolean).join(" · ");
      if (subText) {
        var sub = document.createElement("div"); sub.className = "li-sub"; sub.textContent = subText;
        text.appendChild(sub);
      }
      li.appendChild(n); li.appendChild(text);
      li.addEventListener("click", function () { loadTrack(i, 0, true); });
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") loadTrack(i, 0, true); });
      ul.appendChild(li);
    });
    $("tracks").classList.toggle("hidden", tape.tracks.length < 2);
  }

  function markTrack() {
    Array.prototype.forEach.call($("tracks").children, function (li, i) {
      li.classList.toggle("current", i === idx);
    });
    var tr = tape.tracks[idx];
    $("title").textContent = tr.title;
    $("artist").textContent = tr.artist || tape.artist || "";
    $("trackNum").textContent = tape.tracks.length > 1 ? (idx + 1) + " / " + tape.tracks.length : "";
    if (isSide()) $("total").textContent = fmt(tape.side.durations[idx]);
  }

  function startPlaying() {
    var p = audio.play();
    if (p && p.catch) p.catch(function (e) { log("play refused: " + e.name + screenNote()); });
  }

  // Go to track n, offset seconds into it.
  function loadTrack(n, offset, autoplay) {
    if (!tape || n < 0 || n >= tape.tracks.length) return Promise.resolve();
    idx = n;
    markTrack();
    setMetadata();

    if (isSide()) {
      var target = tape.side.starts[n] + (offset || 0);
      return getSideUrl().then(function (u) {
        if (audio.getAttribute("src") !== u) {
          pendingSeek = target > 0 ? target : null;
          audio.src = u;
        } else {
          audio.currentTime = target;
        }
        savePosition();
        if (autoplay && audio.paused) startPlaying();
        updatePosition();
      }).catch(function (e) { log("couldn't load the side: " + e.message); });
    }

    return getTrackUrl(n).then(function (u) {
      pendingSeek = offset > 0 ? offset : null;
      audio.src = u;
      prune();
      savePosition();
      if (autoplay) startPlaying();
      if (n + 1 < tape.tracks.length) getTrackUrl(n + 1).catch(function () {});
    }).catch(function (e) { log("couldn't load track " + (n + 1) + ": " + e.message); });
  }

  // ---------- controls ----------

  var PLAY = "M7 4l13 8-13 8z";
  var PAUSE = "M6 4h4v16H6zM14 4h4v16h-4z";

  function playPause() {
    if (!tape) return;
    if (audio.paused) startPlaying(); else audio.pause();
  }
  function nextTrack(reason) {
    if (!tape || idx + 1 >= tape.tracks.length) return;
    log((reason || "next track") + ": " + (idx + 2) + " of " + tape.tracks.length + screenNote());
    loadTrack(idx + 1, 0, isSide() ? !audio.paused : true);
  }
  function prevTrack() {
    if (!tape) return;
    if (trackTime() > 3 || idx === 0) { loadTrack(idx, 0, false); return; }
    log("previous track: " + idx + " of " + tape.tracks.length + screenNote());
    loadTrack(idx - 1, 0, isSide() ? !audio.paused : true);
  }

  $("play").addEventListener("click", playPause);
  $("next").addEventListener("click", function () { nextTrack(); });
  $("prev").addEventListener("click", prevTrack);

  $("removeBtn").addEventListener("click", function () {
    if (!tape) return;
    var t = tape;
    closeTape();
    openCache().then(function (c) { return removeFiles(c, t); }).then(function () {
      if (artUrls[t.id]) { URL.revokeObjectURL(artUrls[t.id]); delete artUrls[t.id]; }
      tapes = tapes.filter(function (x) { return x.id !== t.id; });
      return saveIndex();
    }).then(function () {
      try {
        var pos = readPosition();
        if (pos && pos.tapeId === t.id) localStorage.removeItem(POS_KEY);
      } catch (e) {}
      log("removed \"" + t.title + "\" from phone");
      renderShelf(); show("shelf");
    });
  });

  var dragging = false;
  $("seek").addEventListener("input", function () {
    dragging = true;
    $("now").textContent = fmt($("seek").value / 1000 * (trackLength() || 0));
  });
  $("seek").addEventListener("change", function () {
    dragging = false;
    var len = trackLength();
    if (isFinite(len)) loadTrack(idx, $("seek").value / 1000 * len, false);
  });

  var lastSave = 0;
  audio.addEventListener("timeupdate", function () {
    // Until the jump to the saved spot has happened, the side reads 0:00; ignore that.
    // Also ignore reports from a player with nothing loaded yet (left over from clearing it).
    if (!tape || pendingSeek !== null || leaving || audio.readyState < 1) return;
    if (isSide()) {
      var i = trackAt(audio.currentTime);
      if (i !== idx) {
        idx = i;
        markTrack();
        setMetadata();
        log("now on track " + (idx + 1) + " of " + tape.tracks.length + (audio.paused ? "" : " (still playing)") + screenNote());
        savePosition();
      }
    }
    $("now").textContent = fmt(trackTime());
    var len = trackLength();
    if (!dragging && len) $("seek").value = Math.round(Math.min(1, trackTime() / len) * 1000);
    var t = Date.now();
    if (t - lastSave > 5000) { lastSave = t; savePosition(); updatePosition(); }
  });
  audio.addEventListener("loadedmetadata", function () {
    if (!isSide()) $("total").textContent = fmt(audio.duration);
    if (pendingSeek !== null) {
      audio.currentTime = Math.min(pendingSeek, Math.max(0, audio.duration - 1));
      pendingSeek = null;
    }
    updatePosition();
  });
  audio.addEventListener("play", function () {
    $("icon").setAttribute("d", PAUSE); $("play").setAttribute("aria-label", "Pause");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    log("playing track " + (idx + 1) + " from " + fmt(trackTime()) + screenNote());
    savePosition();
  });
  audio.addEventListener("pause", function () {
    if (audio.ended) return;
    $("icon").setAttribute("d", PLAY); $("play").setAttribute("aria-label", "Play");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
    if (quietPause) { quietPause = false; return; }
    if (!tape) return;
    log("paused track " + (idx + 1) + " at " + fmt(trackTime()) + screenNote());
    savePosition();
  });
  audio.addEventListener("ended", function () {
    if (tape && !isSide() && idx + 1 < tape.tracks.length) {
      nextTrack("track " + (idx + 1) + " finished, moving on");
      return;
    }
    $("icon").setAttribute("d", PLAY); $("play").setAttribute("aria-label", "Play");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
    log("end of tape" + screenNote());
    try {
      if (tape) localStorage.setItem(POS_KEY, JSON.stringify({ tapeId: tape.id, idx: 0, time: 0 }));
      localStorage.setItem(LAST_KEY, JSON.stringify({ playing: false }));
    } catch (e) {}
  });
  audio.addEventListener("error", function () {
    var e = audio.error;
    log("playback error " + (e ? e.code : "?") + screenNote());
  });

  // ---------- lock screen ----------

  function setMetadata() {
    if (!("mediaSession" in navigator) || !tape) return;
    var tr = tape.tracks[idx];
    var art = tape.art ? [
      { src: artKey(tape), sizes: "256x256", type: tape.artType || "image/png" },
      { src: artKey(tape), sizes: "512x512", type: tape.artType || "image/png" }
    ] : [{ src: abs("icon-512.png"), sizes: "512x512", type: "image/png" }];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: tr.title, artist: tr.artist || tape.artist || "", album: tape.title, artwork: art
    });
    updatePosition();
  }

  if ("mediaSession" in navigator) {
    var handlers = {
      play: function () { startPlaying(); },
      pause: function () { audio.pause(); },
      stop: function () { audio.pause(); },
      previoustrack: prevTrack,
      nexttrack: function () { nextTrack(); },
      seekbackward: function (d) { loadTrack(idx, Math.max(0, trackTime() - ((d && d.seekOffset) || 10)), false); },
      seekforward: function (d) {
        var to = trackTime() + ((d && d.seekOffset) || 10);
        if (isSide() && to >= trackLength() && idx + 1 < tape.tracks.length) loadTrack(idx + 1, 0, false);
        else loadTrack(idx, Math.min(to, (trackLength() || 1) - 0.5), false);
      },
      seekto: function (d) { if (d && isFinite(d.seekTime)) loadTrack(idx, d.seekTime, false); }
    };
    Object.keys(handlers).forEach(function (k) {
      try { navigator.mediaSession.setActionHandler(k, handlers[k]); } catch (e) {}
    });
  }

  // The lock screen's progress bar shows the current track, not the whole side.
  function updatePosition() {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState || !tape) return;
    var len = trackLength(), pos = trackTime();
    if (!isFinite(len) || len <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: len, playbackRate: audio.playbackRate,
        position: Math.max(0, Math.min(pos, len))
      });
    } catch (e) {}
  }

  window.addEventListener("pagehide", function () { savePosition(); leaving = true; });
  window.addEventListener("pageshow", function () { leaving = false; });

  // ---------- the screen-off test ----------

  var hiddenAt = 0, hiddenTrack = 0, hiddenPos = 0;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      hiddenAt = Date.now(); hiddenTrack = idx; hiddenPos = trackTime();
      if (tape) log("screen off / app hidden: track " + (idx + 1) + " at " + fmt(trackTime()) +
                    (audio.paused ? " (paused)" : " (playing)"));
      savePosition();
    } else if (hiddenAt) {
      var away = Date.now() - hiddenAt;
      if (tape) {
        var where = idx === hiddenTrack
          ? "song moved " + dur((trackTime() - hiddenPos) * 1000)
          : "moved from track " + (hiddenTrack + 1) + " to track " + (idx + 1);
        log("back after " + dur(away) + "; " + where + "; now " +
            (audio.paused ? "paused" : "playing") + " track " + (idx + 1) + " at " + fmt(trackTime()));
      }
      hiddenAt = 0;
    }
  });

  // ---------- start ----------

  loadIndex().then(function () {
    renderShelf();
    var pos = readPosition();
    if (pos && tapes.some(function (t) { return t.id === pos.tapeId; })) return openTape(pos.tapeId);
    if (tapes.length === 1) return openTape(tapes[0].id);
    show(tapes.length ? "shelf" : "add");
  }).catch(function (e) {
    log("couldn't open the shelf: " + e.message);
    show("shelf");
  });
})();
