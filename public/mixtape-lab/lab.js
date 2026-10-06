// Mixtape lab: answers three questions before the Foundry's mixtape type is
// built. A) Can this browser fetch the songs and artwork (from the owner's PDS
// and from plyr.fm's storage)? B) Do the songs join into one side as they are?
// C) How fast does converting to 96 kbps go here, and does the result join?

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var tracks = [];        // fm.plyr.track records, simplified
  var did = null, pds = null;
  var bytesCache = {};    // rkey -> Uint8Array (downloaded originals)
  var playerUrls = [];

  // ---------- results ----------

  function out(line) {
    $("out").textContent += line + "\n";
    $("out").scrollTop = $("out").scrollHeight;
  }
  function status(text) { $("status").textContent = text; }
  $("copyBtn").addEventListener("click", function () {
    var text = $("out").textContent;
    var done = function () { $("copyBtn").textContent = "Copied"; setTimeout(function () { $("copyBtn").textContent = "Copy results"; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { selectOut(); });
    } else selectOut();
  });
  function selectOut() {
    var r = document.createRange(); r.selectNodeContents($("out"));
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    status("Select-all is done: use your device's Copy.");
  }
  $("clearBtn").addEventListener("click", function () { $("out").textContent = ""; deviceLine(); });

  function deviceLine() {
    var ua = navigator.userAgent;
    out("== Mixtape lab, " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC");
    out("device: " + ua);
    out("memory: " + (navigator.deviceMemory ? navigator.deviceMemory + " GB (approx)" : "unknown") +
        ", cores: " + (navigator.hardwareConcurrency || "unknown") + ", page: " + location.origin);
  }
  deviceLine();

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function mb(n) { return (n / 1048576).toFixed(1) + " MB"; }
  function secs(ms) { return (ms / 1000).toFixed(1) + " s"; }

  // ---------- loading the track list ----------

  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("request failed (" + r.status + ")");
      return r.json();
    });
  }

  function load() {
    var handle = $("handle").value.trim().replace(/^@/, "").toLowerCase();
    if (!handle) return;
    $("loadBtn").disabled = true;
    status("Looking up @" + handle + "…");
    $("shows").innerHTML = "";
    tracks = []; bytesCache = {};
    getJson("https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=" + encodeURIComponent(handle))
      .then(function (j) {
        did = j.did;
        var url = did.indexOf("did:web:") === 0
          ? "https://" + did.slice(8) + "/.well-known/did.json"
          : "https://plc.directory/" + did;
        return getJson(url);
      }).then(function (doc) {
        var svc = (doc.service || []).filter(function (s) { return s.id === "#atproto_pds"; })[0];
        if (!svc) throw new Error("no PDS in the DID document");
        pds = svc.serviceEndpoint.replace(/\/$/, "");
        var all = [];
        function page(cursor, n) {
          status("Reading tracks… " + all.length);
          return getJson(pds + "/xrpc/com.atproto.repo.listRecords?repo=" + encodeURIComponent(did) +
            "&collection=fm.plyr.track&limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""))
            .then(function (j) {
              all = all.concat(j.records || []);
              if (j.cursor && (j.records || []).length && n < 20) return page(j.cursor, n + 1);
              return all;
            });
        }
        return page(null, 0);
      }).then(function (records) {
        tracks = records.map(function (r) {
          var v = r.value || {};
          var blob = v.audioBlob && v.audioBlob.ref ? v.audioBlob : null;
          return {
            rkey: r.uri.split("/").pop(), uri: r.uri, cid: r.cid,
            title: String(v.title || "(untitled)"), album: String(v.album || "(no album)"),
            duration: Number(v.duration) || 0, fileType: String(v.fileType || "?"),
            blobCid: blob ? (blob.ref.$link || String(blob.ref)) : null,
            blobSize: blob ? blob.size : null, blobType: blob ? blob.mimeType : null,
            audioUrl: v.audioUrl || null, imageUrl: v.imageUrl || null,
            gated: !!v.supportGate
          };
        });
        renderShows();
        var onPds = tracks.filter(function (t) { return t.blobCid; }).length;
        out("");
        out("== Tracks for @" + handle + " (" + did + ")");
        out("PDS: " + pds);
        out(tracks.length + " tracks; audio on your PDS: " + onPds + "; plyr.fm storage only: " + (tracks.length - onPds) +
            "; supporter-only: " + tracks.filter(function (t) { return t.gated; }).length);
        status("Loaded " + tracks.length + " tracks. Tick a few songs, then run a test.");
      }).catch(function (e) {
        status("Couldn't load tracks: " + e.message);
        out("load failed: " + e.message);
      }).then(function () { $("loadBtn").disabled = false; });
  }
  $("loadBtn").addEventListener("click", load);
  $("handle").addEventListener("keydown", function (e) { if (e.key === "Enter") load(); });

  function renderShows() {
    var byAlbum = {}, order = [];
    tracks.forEach(function (t) {
      if (!byAlbum[t.album]) { byAlbum[t.album] = []; order.push(t.album); }
      byAlbum[t.album].push(t);
    });
    var box = $("shows");
    box.innerHTML = "";
    order.forEach(function (album) {
      var list = byAlbum[album].slice().sort(function (a, b) { return a.title.localeCompare(b.title, undefined, { numeric: true }); });
      var d = document.createElement("details");
      d.className = "show";
      var s = document.createElement("summary");
      var onPds = list.filter(function (t) { return t.blobCid; }).length;
      s.textContent = album + " ";
      var c = document.createElement("span"); c.className = "count";
      c.textContent = "(" + list.length + " tracks" + (onPds ? ", " + onPds + " on your PDS" : "") + ")";
      s.appendChild(c);
      d.appendChild(s);
      list.forEach(function (t) {
        var row = document.createElement("label");
        row.className = "track";
        var cb = document.createElement("input"); cb.type = "checkbox"; cb.value = t.rkey;
        cb.addEventListener("change", updateSel);
        var title = document.createElement("span"); title.className = "t"; title.textContent = t.title + (t.gated ? " (supporters only)" : "");
        var len = document.createElement("span"); len.className = "len"; len.textContent = fmt(t.duration);
        var where = document.createElement("span");
        where.className = "where" + (t.blobCid ? " pds" : "");
        where.textContent = t.blobCid ? "your PDS" : "plyr.fm storage";
        row.appendChild(cb); row.appendChild(title); row.appendChild(len); row.appendChild(where);
        d.appendChild(row);
      });
      box.appendChild(d);
    });
    updateSel();
  }

  function selected() {
    var keys = Array.prototype.map.call(document.querySelectorAll("#shows input:checked"), function (cb) { return cb.value; });
    return keys.map(function (k) { return tracks.filter(function (t) { return t.rkey === k; })[0]; }).filter(Boolean);
  }
  function updateSel() {
    var sel = selected();
    var total = sel.reduce(function (s, t) { return s + t.duration; }, 0);
    $("sel").textContent = sel.length ? sel.length + " ticked · " + fmt(total) : "";
  }

  // ---------- A. fetching ----------

  // Asks for a file and stops as soon as the reply's headers arrive.
  function probe(url) {
    var ctrl = new AbortController(), t0 = performance.now();
    return fetch(url, { signal: ctrl.signal }).then(function (res) {
      var info = {
        ok: res.ok, status: res.status, ms: performance.now() - t0,
        type: res.headers.get("content-type") || "?",
        length: Number(res.headers.get("content-length")) || null,
        ranges: res.headers.get("accept-ranges") || "not stated"
      };
      ctrl.abort();
      return info;
    }).catch(function (e) {
      return { blocked: true, error: e.name + ": " + e.message, ms: performance.now() - t0 };
    });
  }
  function describeProbe(p) {
    if (p.blocked) return "BLOCKED or unreachable (" + p.error + ") — usually the server not allowing other websites (CORS)";
    if (!p.ok) return "HTTP " + p.status;
    return "OK in " + Math.round(p.ms) + " ms, " + p.type + (p.length ? ", " + mb(p.length) : "") + ", ranges: " + p.ranges;
  }
  function imgTest(url) {
    return new Promise(function (resolve) {
      var img = new Image(), done = false;
      img.onload = function () { if (!done) { done = true; resolve("shows as a picture (" + img.naturalWidth + "×" + img.naturalHeight + ")"); } };
      img.onerror = function () { if (!done) { done = true; resolve("does NOT show as a picture"); } };
      setTimeout(function () { if (!done) { done = true; resolve("no answer after 15 s"); } }, 15000);
      img.src = url;
    });
  }
  function blobUrl(cid) {
    return pds + "/xrpc/com.atproto.sync.getBlob?did=" + encodeURIComponent(did) + "&cid=" + encodeURIComponent(cid);
  }

  function testFetching() {
    var sel = selected();
    if (!sel.length) { status("Tick at least one song first."); return; }
    lock(true);
    out("");
    out("== A. Fetching (" + sel.length + " songs)");
    var arts = {};
    sel.reduce(function (p, t, i) {
      return p.then(function () {
        status("Testing " + (i + 1) + " of " + sel.length + "…");
        out("- " + t.title + " [" + t.album + "]");
        var steps = Promise.resolve();
        if (t.blobCid) {
          steps = steps.then(function () { return probe(blobUrl(t.blobCid)); })
            .then(function (p) { out("    your PDS:        " + describeProbe(p)); });
        }
        if (t.audioUrl) {
          steps = steps.then(function () { return probe(t.audioUrl); })
            .then(function (p) { out("    plyr.fm storage: " + describeProbe(p)); });
        }
        if (t.imageUrl && !arts[t.imageUrl]) {
          arts[t.imageUrl] = true;
          steps = steps.then(function () { return probe(t.imageUrl); })
            .then(function (p) { out("    artwork (read):  " + describeProbe(p)); return imgTest(t.imageUrl); })
            .then(function (r) { out("    artwork (show):  " + r); });
        }
        return steps;
      });
    }, Promise.resolve()).then(function () {
      status("Fetching test done. Results are below.");
    }).then(function () { lock(false); });
  }
  $("fetchBtn").addEventListener("click", testFetching);

  // ---------- downloading whole songs ----------

  function download(url, label) {
    var t0 = performance.now();
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      var total = Number(res.headers.get("content-length")) || 0;
      if (!res.body || !res.body.getReader) return res.arrayBuffer().then(function (b) { return new Uint8Array(b); });
      var reader = res.body.getReader(), chunks = [], got = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            var all = new Uint8Array(got), at = 0;
            chunks.forEach(function (c) { all.set(c, at); at += c.length; });
            return all;
          }
          chunks.push(r.value); got += r.value.length;
          status("Downloading " + label + "… " + (total ? Math.floor(got / total * 100) + "%" : mb(got)));
          return pump();
        });
      }
      return pump();
    }).then(function (bytes) {
      var ms = performance.now() - t0;
      return { bytes: bytes, ms: ms };
    });
  }

  // PDS first (guaranteed fetchable), then plyr.fm storage.
  function getSong(t) {
    if (bytesCache[t.rkey]) return Promise.resolve(bytesCache[t.rkey]);
    var tries = [];
    if (t.blobCid) tries.push({ url: blobUrl(t.blobCid), from: "your PDS" });
    if (t.audioUrl) tries.push({ url: t.audioUrl, from: "plyr.fm storage" });
    function attempt(i) {
      if (i >= tries.length) return Promise.reject(new Error("couldn't download from any source"));
      return download(tries[i].url, t.title).then(function (r) {
        out("    downloaded from " + tries[i].from + ": " + mb(r.bytes.length) + " in " + secs(r.ms) +
            " (" + (r.bytes.length / 1048576 / (r.ms / 1000)).toFixed(1) + " MB/s)");
        bytesCache[t.rkey] = r.bytes;
        return r.bytes;
      }, function (e) {
        out("    " + tries[i].from + " failed: " + e.message);
        return attempt(i + 1);
      });
    }
    return attempt(0);
  }

  // ---------- B. format and join ----------

  function describeScan(s) {
    return (s.kbps ? s.kbps + " kbps" : "variable bitrate") + ", " + s.rate + " Hz, " +
      (s.mono ? "mono" : "stereo") + ", " + fmt(s.seconds) + " (" + s.count + " frames)";
  }

  function addPlayer(title, bytes, starts, names) {
    var box = document.createElement("div");
    var h = document.createElement("h3"); h.textContent = title;
    var a = document.createElement("audio"); a.controls = true; a.preload = "metadata";
    var u = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
    playerUrls.push(u); a.src = u;
    var jumps = document.createElement("div"); jumps.className = "jumps";
    starts.forEach(function (st, i) {
      var b = document.createElement("button"); b.className = "secondary";
      b.textContent = (i + 1) + ". " + names[i].slice(0, 28) + " (" + fmt(st) + ")";
      b.addEventListener("click", function () { a.currentTime = st; a.play(); });
      jumps.appendChild(b);
      if (i > 0) {
        var j = document.createElement("button"); j.className = "secondary";
        j.textContent = "join " + i + "→" + (i + 1) + " (5 s before)";
        j.addEventListener("click", function () { a.currentTime = Math.max(0, st - 5); a.play(); });
        jumps.appendChild(j);
      }
    });
    box.appendChild(h); box.appendChild(a); box.appendChild(jumps);
    $("players").appendChild(box);
  }

  function testJoin() {
    var sel = selected();
    if (sel.length < 1) { status("Tick at least one song first (two or more to test joining)."); return; }
    lock(true);
    out("");
    out("== B. Format and join (" + sel.length + " songs)");
    var list = [];
    sel.reduce(function (p, t, i) {
      return p.then(function () {
        status("Downloading " + (i + 1) + " of " + sel.length + "…");
        out("- " + t.title);
        return getSong(t).then(function (b) {
          try { out("    format: " + describeScan(Mp3Join.scan(b))); }
          catch (e) { out("    format: can't read (" + e.message + ")"); }
          list.push({ t: t, bytes: b });
        }, function (e) { out("    skipped: " + e.message); });
      });
    }, Promise.resolve()).then(function () {
      if (list.length < 2) { out("(need two downloaded songs to test joining)"); return; }
      try {
        var t0 = performance.now();
        var j = Mp3Join.join(list.map(function (x) { return x.bytes; }));
        out("JOIN OK in " + Math.round(performance.now() - t0) + " ms: " + fmt(j.total) + ", " + mb(j.bytes.length) + ", " + j.format);
        out("    track starts: " + j.starts.map(fmt).join(", "));
        addPlayer("As they are (" + j.format + ")", j.bytes, j.starts, list.map(function (x) { return x.t.title; }));
      } catch (e) {
        out("JOIN NOT POSSIBLE as they are: " + e.message);
      }
    }).then(function () {
      status("Join test done. Try the joins in the player to listen for clicks.");
      lock(false);
    });
  }
  $("joinBtn").addEventListener("click", testJoin);

  // ---------- C. convert ----------

  function encode(left, right, rate, kbps, label) {
    return new Promise(function (resolve, reject) {
      var w = new Worker("encode-worker.js");
      w.onmessage = function (e) {
        var d = e.data;
        if (d.progress !== undefined) status("Converting " + label + "… " + d.progress + "%");
        else if (d.error) { w.terminate(); reject(new Error(d.error)); }
        else if (d.done) { w.terminate(); resolve(d.mp3); }
      };
      w.onerror = function (e) { w.terminate(); reject(new Error(e.message || "the encoder couldn't start")); };
      w.postMessage({ left: left, right: right, sampleRate: rate, kbps: kbps }, [left.buffer, right.buffer]);
    });
  }

  function convertOne(t, bytes) {
    var RATE = 44100, t0 = performance.now();
    // decodeAudioData on a 44.1 kHz context also resamples to 44.1 kHz.
    var ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, RATE, RATE);
    return ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).then(function (buf) {
      var tDecode = performance.now() - t0;
      var pcmMb = (buf.length * buf.numberOfChannels * 4) / 1048576;
      out("    decoded in " + secs(tDecode) + " (" + fmt(buf.duration) + ", " + buf.numberOfChannels + " ch, about " + Math.round(pcmMb) + " MB of raw audio in memory)");
      var left = buf.getChannelData(0).slice();
      var right = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice();
      var duration = buf.duration;
      buf = null;
      var t1 = performance.now();
      return encode(left, right, RATE, 96, t.title).then(function (mp3) {
        var tEnc = performance.now() - t1;
        out("    encoded in " + secs(tEnc) + " (" + (duration / (tEnc / 1000)).toFixed(1) + "× real time): " +
            mb(bytes.length) + " → " + mb(mp3.length));
        out("    total for this song: " + secs(performance.now() - t0));
        return mp3;
      });
    });
  }

  function testConvert() {
    var sel = selected();
    if (!sel.length) { status("Tick at least one song first."); return; }
    lock(true);
    out("");
    out("== C. Convert to 96 kbps (" + sel.length + " songs)");
    var made = [], tAll = performance.now();
    sel.reduce(function (p, t, i) {
      return p.then(function () {
        out("- " + t.title + " (" + fmt(t.duration) + ")");
        return getSong(t).then(function (b) {
          status("Converting " + (i + 1) + " of " + sel.length + "…");
          return convertOne(t, b).then(function (mp3) {
            try { out("    result: " + describeScan(Mp3Join.scan(mp3))); } catch (e) { out("    result unreadable: " + e.message); }
            made.push({ t: t, bytes: mp3 });
          });
        }).catch(function (e) { out("    FAILED: " + e.message); });
      });
    }, Promise.resolve()).then(function () {
      out("all conversions: " + secs(performance.now() - tAll));
      if (made.length < 2) { if (made.length === 1) addPlayer("Converted (96 kbps)", made[0].bytes, [0], [made[0].t.title]); return; }
      try {
        var j = Mp3Join.join(made.map(function (x) { return x.bytes; }));
        out("JOIN OK after converting: " + fmt(j.total) + ", " + mb(j.bytes.length) + ", " + j.format);
        out("    track starts: " + j.starts.map(fmt).join(", "));
        addPlayer("Converted and joined (96 kbps)", j.bytes, j.starts, made.map(function (x) { return x.t.title; }));
      } catch (e) {
        out("JOIN FAILED after converting: " + e.message);
      }
    }).then(function () {
      status("Convert test done. Results are below; listen to the joins in the player.");
      lock(false);
    });
  }
  $("convertBtn").addEventListener("click", testConvert);

  function lock(on) {
    ["fetchBtn", "joinBtn", "convertBtn", "loadBtn"].forEach(function (id) { $(id).disabled = on; });
  }
})();
