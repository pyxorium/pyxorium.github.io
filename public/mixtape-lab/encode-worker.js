// Mixtape lab: MP3 encoding in a worker, so the page stays responsive.
// Uses lamejs (LAME, LGPL-3.0; see LAME-LICENSE.txt), unmodified.

importScripts("lame.min.js");

self.onmessage = function (e) {
  var d = e.data;
  try {
    var left = d.left, right = d.right, kbps = d.kbps, rate = d.sampleRate;
    var enc = new lamejs.Mp3Encoder(2, rate, kbps);
    // lamejs mis-encodes (near silence) when given more than one MP3 frame's
    // worth of samples per call, so feed it exactly 1152 at a time.
    var block = 1152;
    var l16 = new Int16Array(block), r16 = new Int16Array(block);
    var parts = [], total = 0, lastPct = -1;

    function toInt16(src, dst, start, n) {
      for (var i = 0; i < n; i++) {
        var s = src[start + i];
        s = s < -1 ? -1 : s > 1 ? 1 : s;
        dst[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
    }

    for (var pos = 0; pos < left.length; pos += block) {
      var n = Math.min(block, left.length - pos);
      var lb = n === block ? l16 : new Int16Array(n);
      var rb = n === block ? r16 : new Int16Array(n);
      toInt16(left, lb, pos, n);
      toInt16(right, rb, pos, n);
      var out = enc.encodeBuffer(lb, rb);
      if (out.length) { parts.push(new Uint8Array(out.buffer, out.byteOffset, out.length).slice()); total += out.length; }
      var pct = Math.floor(pos / left.length * 100);
      if (pct !== lastPct) { lastPct = pct; self.postMessage({ progress: pct }); }
    }
    var end = enc.flush();
    if (end.length) { parts.push(new Uint8Array(end.buffer, end.byteOffset, end.length).slice()); total += end.length; }

    var mp3 = new Uint8Array(total), at = 0;
    parts.forEach(function (p) { mp3.set(p, at); at += p.length; });
    self.postMessage({ done: true, mp3: mp3 }, [mp3.buffer]);
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
  }
};
