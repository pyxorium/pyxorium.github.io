// Tileman proof of concept: save one song from a Web Tile onto the phone,
// then play it like a music app (lock-screen controls, screen off, offline).

(function () {
  "use strict";

  var TAPE_CACHE = "tileman-tapes";
  var INFO_URL = new URL("tape/info.json", location.href).href;
  var AUDIO_URL = new URL("tape/audio", location.href).href;
  var ART_URL = new URL("tape/art", location.href).href;
  var LOG_KEY = "tileman-log";
  var LAST_KEY = "tileman-last";

  var $ = function (id) { return document.getElementById(id); };
  var audio = $("audio");
  var info = null;
  var objectUrl = null;

  // ---------- test log (kept across restarts) ----------

  function stamp() {
    var d = new Date();
    return d.toTimeString().slice(0, 8);
  }
  function readLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch (e) { return []; }
  }
  function log(msg) {
    var lines = readLog();
    lines.push(stamp() + "  " + msg);
    if (lines.length > 200) lines = lines.slice(-200);
    try { localStorage.setItem(LOG_KEY, JSON.stringify(lines)); } catch (e) {}
    $("log").textContent = lines.join("\n");
    $("log").scrollTop = $("log").scrollHeight;
  }
  $("log").textContent = readLog().join("\n");
  $("clearLog").addEventListener("click", function () {
    try { localStorage.removeItem(LOG_KEY); } catch (e) {}
    $("log").textContent = "";
  });

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function mins(ms) {
    var s = Math.round(ms / 1000);
    return Math.floor(s / 60) + "m " + (s % 60) + "s";
  }

  // ---------- online / offline indicator ----------

  function showNet() {
    var on = navigator.onLine;
    $("net").textContent = on ? "online" : "offline";
    $("net").classList.toggle("off", !on);
  }
  window.addEventListener("online", function () { showNet(); log("network: online"); });
  window.addEventListener("offline", function () { showNet(); log("network: offline"); });
  showNet();

  // ---------- service worker ----------

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function (e) {
      log("offline support failed to start: " + e.message);
    });
  } else {
    log("this browser has no offline support");
  }

  // ---------- how the last session ended ----------

  (function () {
    try {
      var last = JSON.parse(localStorage.getItem(LAST_KEY) || "null");
      if (last && last.playing) {
        log("last session was playing; last saved position " + fmt(last.pos) +
            " at " + new Date(last.at).toTimeString().slice(0, 8) +
            " (the app was closed or stopped after that)");
      }
    } catch (e) {}
  })();

  function saveLast() {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({
        playing: !audio.paused, pos: audio.currentTime, at: Date.now()
      }));
    } catch (e) {}
  }

  // ---------- reading a tile from the network ----------

  function parseAtUri(s) {
    var m = /^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)$/.exec(s.trim());
    if (!m) throw new Error("That doesn't look like an at:// tile address.");
    return { repo: m[1], collection: m[2], rkey: m[3] };
  }

  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("Request failed (" + r.status + ") for " + url);
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

  // Check a downloaded file against its content address (CIDv1, raw, sha2-256).
  function b32(bytes) {
    var alphabet = "abcdefghijklmnopqrstuvwxyz234567", out = "", bits = 0, value = 0;
    for (var i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i]; bits += 8;
      while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
    return out;
  }
  function rawCid(blob) {
    if (!(window.crypto && crypto.subtle)) return Promise.resolve(null);
    return blob.arrayBuffer().then(function (buf) {
      return crypto.subtle.digest("SHA-256", buf);
    }).then(function (hash) {
      var bytes = new Uint8Array(36);
      bytes.set([0x01, 0x55, 0x12, 0x20]);
      bytes.set(new Uint8Array(hash), 4);
      return "b" + b32(bytes);
    });
  }

  function addTape() {
    var btn = $("addBtn");
    btn.disabled = true;
    $("addMsg").classList.remove("error");
    $("addMsg").textContent = "Looking up the tile…";
    var target, did, pds, tile, audioRes, artRes;

    Promise.resolve().then(function () {
      target = parseAtUri($("addr").value);
      return resolveDid(target.repo);
    }).then(function (d) {
      did = d;
      return findPds(did);
    }).then(function (p) {
      pds = p;
      return getJson(pds + "/xrpc/com.atproto.repo.getRecord?repo=" + encodeURIComponent(did) +
        "&collection=" + encodeURIComponent(target.collection) + "&rkey=" + encodeURIComponent(target.rkey));
    }).then(function (rec) {
      tile = rec.value && rec.value.tile;
      if (!tile || !tile.resources) throw new Error("That record isn't a Web Tile.");
      var res = tile.resources;
      var audioPath = Object.keys(res).filter(function (k) {
        return String(res[k]["content-type"] || "").indexOf("audio/") === 0;
      })[0];
      if (!audioPath) throw new Error("This tile has no song file in it.");
      audioRes = res[audioPath];

      var artPath = (tile.icons && tile.icons[0] && tile.icons[0].src) ||
                    (tile.screenshots && tile.screenshots[0] && tile.screenshots[0].src);
      artRes = artPath && res[artPath] ? res[artPath] : null;

      var blobUrl = function (r) {
        return pds + "/xrpc/com.atproto.sync.getBlob?did=" + encodeURIComponent(did) +
          "&cid=" + encodeURIComponent(r.src.ref.$link);
      };
      return download(blobUrl(audioRes), "the song").then(function (songBlob) {
        return (artRes ? download(blobUrl(artRes), "the artwork") : Promise.resolve(null))
          .then(function (artBlob) { return [songBlob, artBlob]; });
      });
    }).then(function (blobs) {
      $("addMsg").textContent = "Checking the files…";
      return Promise.all([rawCid(blobs[0]), blobs[1] ? rawCid(blobs[1]) : null]).then(function (cids) {
        if (cids[0] && cids[0] !== audioRes.src.ref.$link) throw new Error("The song didn't match its address.");
        if (blobs[1] && cids[1] && cids[1] !== artRes.src.ref.$link) throw new Error("The artwork didn't match its address.");
        return blobs;
      });
    }).then(function (blobs) {
      $("addMsg").textContent = "Saving to this phone…";
      var meta = {
        uri: "at://" + did + "/" + target.collection + "/" + target.rkey,
        title: tile.name || "Untitled",
        artist: $("artistIn").value.trim(),
        audioType: audioRes["content-type"],
        artType: artRes ? artRes["content-type"] : null,
        size: blobs[0].size,
        savedAt: new Date().toISOString()
      };
      return caches.open(TAPE_CACHE).then(function (c) {
        var puts = [
          c.put(AUDIO_URL, new Response(blobs[0], { headers: { "Content-Type": meta.audioType } })),
          c.put(INFO_URL, new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }))
        ];
        if (blobs[1]) puts.push(c.put(ART_URL, new Response(blobs[1], { headers: { "Content-Type": meta.artType } })));
        return Promise.all(puts);
      }).then(function () { return meta; });
    }).then(function (meta) {
      log("saved \"" + meta.title + "\" (" + (meta.size / 1048576).toFixed(1) + " MB)");
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then(function (ok) {
          log(ok ? "phone will keep saved tapes (persistent storage granted)"
                 : "persistent storage not granted; the phone may clear tapes if space runs low");
        });
      }
      $("addMsg").textContent = "";
      return loadTape();
    }).catch(function (e) {
      $("addMsg").classList.add("error");
      $("addMsg").textContent = e.message;
      log("add failed: " + e.message);
    }).then(function () {
      btn.disabled = false;
    });
  }
  $("addBtn").addEventListener("click", addTape);

  // ---------- the saved tape ----------

  function loadTape() {
    return caches.open(TAPE_CACHE).then(function (c) {
      return Promise.all([c.match(INFO_URL), c.match(AUDIO_URL), c.match(ART_URL)]);
    }).then(function (r) {
      if (!r[0] || !r[1]) { showAdd(); return; }
      return Promise.all([r[0].json(), r[1].blob(), r[2] ? true : false]).then(function (x) {
        info = x[0];
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(x[1]);
        audio.src = objectUrl;
        $("title").textContent = info.title;
        $("artist").textContent = info.artist || "";
        if (x[2]) { $("art").src = ART_URL; $("art").classList.remove("hidden"); }
        else { $("art").classList.add("hidden"); }
        setupMediaSession(x[2]);
        showPlayer();
      });
    });
  }

  function showAdd() { $("add").classList.remove("hidden"); $("player").classList.add("hidden"); }
  function showPlayer() { $("add").classList.add("hidden"); $("player").classList.remove("hidden"); }

  $("removeBtn").addEventListener("click", function () {
    audio.pause();
    caches.delete(TAPE_CACHE).then(function () {
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      audio.removeAttribute("src"); audio.load();
      info = null;
      log("tape removed from phone");
      showAdd();
    });
  });

  // ---------- playback ----------

  var PLAY = "M7 4l13 8-13 8z";
  var PAUSE = "M6 4h4v16H6zM14 4h4v16h-4z";

  $("play").addEventListener("click", function () {
    if (audio.paused) {
      var p = audio.play();
      if (p && p.catch) p.catch(function (e) { log("play refused: " + e.name); });
    } else {
      audio.pause();
    }
  });

  var dragging = false;
  $("seek").addEventListener("input", function () {
    dragging = true;
    $("now").textContent = fmt($("seek").value / 1000 * (audio.duration || 0));
  });
  $("seek").addEventListener("change", function () {
    dragging = false;
    if (isFinite(audio.duration)) audio.currentTime = $("seek").value / 1000 * audio.duration;
  });

  var lastSave = 0;
  audio.addEventListener("timeupdate", function () {
    $("now").textContent = fmt(audio.currentTime);
    if (!dragging && audio.duration) $("seek").value = Math.round(audio.currentTime / audio.duration * 1000);
    var t = Date.now();
    if (t - lastSave > 5000) { lastSave = t; saveLast(); updatePosition(); }
  });
  audio.addEventListener("loadedmetadata", function () {
    $("total").textContent = fmt(audio.duration);
    updatePosition();
  });
  audio.addEventListener("play", function () {
    $("icon").setAttribute("d", PAUSE); $("play").setAttribute("aria-label", "Pause");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    log("playing from " + fmt(audio.currentTime) + (document.hidden ? " (screen off)" : ""));
    saveLast();
  });
  audio.addEventListener("pause", function () {
    $("icon").setAttribute("d", PLAY); $("play").setAttribute("aria-label", "Play");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
    log("paused at " + fmt(audio.currentTime) + (document.hidden ? " (screen off)" : ""));
    saveLast();
  });
  audio.addEventListener("ended", function () { log("song finished"); saveLast(); });
  audio.addEventListener("error", function () {
    var e = audio.error;
    log("playback error " + (e ? e.code : "?"));
  });

  // ---------- lock screen ----------

  function setupMediaSession(hasArt) {
    if (!("mediaSession" in navigator)) { log("no lock-screen controls in this browser"); return; }
    var art = hasArt ? [
      { src: ART_URL, sizes: "256x256", type: info.artType || "image/png" },
      { src: ART_URL, sizes: "512x512", type: info.artType || "image/png" }
    ] : [{ src: new URL("icon-512.png", location.href).href, sizes: "512x512", type: "image/png" }];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: info.title, artist: info.artist || "", album: "Tileman", artwork: art
    });
    var handlers = {
      play: function () { audio.play(); },
      pause: function () { audio.pause(); },
      stop: function () { audio.pause(); },
      seekbackward: function (d) { audio.currentTime = Math.max(0, audio.currentTime - ((d && d.seekOffset) || 10)); },
      seekforward: function (d) { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + ((d && d.seekOffset) || 10)); },
      seekto: function (d) { if (d && isFinite(d.seekTime)) audio.currentTime = d.seekTime; }
    };
    Object.keys(handlers).forEach(function (k) {
      try { navigator.mediaSession.setActionHandler(k, handlers[k]); } catch (e) {}
    });
  }

  function updatePosition() {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    if (!isFinite(audio.duration) || audio.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration, playbackRate: audio.playbackRate,
        position: Math.min(audio.currentTime, audio.duration)
      });
    } catch (e) {}
  }

  // ---------- the screen-off test ----------

  var hiddenAt = 0, hiddenPos = 0;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      hiddenAt = Date.now(); hiddenPos = audio.currentTime;
      log("screen off / app hidden at " + fmt(audio.currentTime) + (audio.paused ? " (paused)" : " (playing)"));
      saveLast();
    } else if (hiddenAt) {
      var away = Date.now() - hiddenAt, moved = audio.currentTime - hiddenPos;
      log("back after " + mins(away) + "; song moved " + mins(moved * 1000) +
          "; now " + (audio.paused ? "paused" : "playing") + " at " + fmt(audio.currentTime));
      hiddenAt = 0;
    }
  });

  loadTape().catch(function (e) { log("couldn't open saved tape: " + e.message); showAdd(); });
})();
