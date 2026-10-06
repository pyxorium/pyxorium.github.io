// Joins MP3 files end to end into one continuous "side".
//
// Each file is reduced to its bare audio frames: ID3 tags are dropped, and so
// is the Xing/Info/VBRI header frame that encoders put first (it states that
// one file's length, which would make the joined side look as short as its
// first track). Files only join when they match: same MPEG version, Layer III,
// sample rate, mono/stereo and bitrate, so the side plays and seeks smoothly.

(function (root) {
  "use strict";

  var BITRATES = {
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],   // MPEG-1 Layer III
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]        // MPEG-2/2.5 Layer III
  };
  var RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

  function header(b, i) {
    if (i + 4 > b.length || b[i] !== 0xFF || (b[i + 1] & 0xE0) !== 0xE0) return null;
    var ver = (b[i + 1] >> 3) & 3;          // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
    var layer = (b[i + 1] >> 1) & 3;        // 1 = Layer III
    var brIdx = b[i + 2] >> 4;
    var srIdx = (b[i + 2] >> 2) & 3;
    var pad = (b[i + 2] >> 1) & 1;
    var mode = b[i + 3] >> 6;               // 3 = mono
    if (ver === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
    var kbps = BITRATES[ver === 3 ? 1 : 2][brIdx];
    var rate = RATES[ver][srIdx];
    var len = ver === 3 ? Math.floor(144000 * kbps / rate) + pad : Math.floor(72000 * kbps / rate) + pad;
    return {
      ver: ver, kbps: kbps, rate: rate, mono: mode === 3, len: len,
      samples: ver === 3 ? 1152 : 576,
      sideInfo: ver === 3 ? (mode === 3 ? 17 : 32) : (mode === 3 ? 9 : 17)
    };
  }

  function text(b, i, s) {
    for (var k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false;
    return true;
  }

  // Returns { frames: [start, end] list, count, rate, mono, ver, kbps, seconds } or throws.
  function scan(bytes) {
    var b = bytes, i = 0, end = b.length;
    // ID3v2 at the start (possibly more than one)
    while (end - i >= 10 && text(b, i, "ID3")) {
      var size = ((b[i + 6] & 0x7F) << 21) | ((b[i + 7] & 0x7F) << 14) | ((b[i + 8] & 0x7F) << 7) | (b[i + 9] & 0x7F);
      i += 10 + size + ((b[i + 5] & 0x10) ? 10 : 0);
    }
    // ID3v1 at the end
    if (end >= 128 && text(b, end - 128, "TAG")) end -= 128;
    // APE tag at the end
    if (end >= 32 && text(b, end - 32, "APETAGEX")) {
      var apeSize = b[end - 20] | (b[end - 19] << 8) | (b[end - 18] << 16) | (b[end - 17] << 24);
      end -= Math.min(end, apeSize + 32);
    }
    // skip stray bytes before the first frame (some files have padding)
    var limit = Math.min(end, i + 65536);
    while (i < limit && !(header(b, i) && header(b, i + header(b, i).len))) i++;
    var first = header(b, i);
    if (!first) throw new Error("no MP3 audio found");

    var frames = [], kbpsAll = {}, n = 0;
    while (i < end) {
      var h = header(b, i);
      if (!h) {
        // tolerate a little junk at the very end of a file
        if (end - i < 2048) break;
        throw new Error("the MP3 data is damaged or unusual");
      }
      if (h.ver !== first.ver || h.rate !== first.rate || h.mono !== first.mono) {
        throw new Error("the format changes partway through the file");
      }
      if (i + h.len > end) break; // incomplete last frame
      var isInfo = n === 0 && (
        text(b, i + 4 + h.sideInfo, "Xing") || text(b, i + 4 + h.sideInfo, "Info") || text(b, i + 36, "VBRI"));
      if (!isInfo) {
        frames.push([i, i + h.len]);
        kbpsAll[h.kbps] = true;
      }
      i += h.len;
      n++;
    }
    if (!frames.length) throw new Error("no MP3 audio found");
    var rates = Object.keys(kbpsAll);
    return {
      frames: frames,
      count: frames.length,
      rate: first.rate, mono: first.mono, ver: first.ver,
      kbps: rates.length === 1 ? Number(rates[0]) : null,   // null = variable bitrate
      seconds: frames.length * first.samples / first.rate
    };
  }

  function describe(s) {
    return (s.kbps ? s.kbps + " kbps" : "variable bitrate") + ", " + s.rate + " Hz, " + (s.mono ? "mono" : "stereo");
  }

  // tracks: array of Uint8Array. Returns { bytes, starts, durations } or throws
  // an Error whose message says why the tracks can't be joined.
  function join(tracks) {
    var scans = tracks.map(function (t, k) {
      try { return scan(t); } catch (e) { throw new Error("track " + (k + 1) + ": " + e.message); }
    });
    var a = scans[0];
    if (!a.kbps) throw new Error("track 1 has a variable bitrate");
    scans.forEach(function (s, k) {
      if (s.ver !== a.ver || s.rate !== a.rate || s.mono !== a.mono || s.kbps !== a.kbps) {
        throw new Error("track " + (k + 1) + " is " + describe(s) + ", track 1 is " + describe(a));
      }
    });
    var total = 0;
    scans.forEach(function (s) { s.frames.forEach(function (f) { total += f[1] - f[0]; }); });
    var out = new Uint8Array(total), pos = 0, starts = [], durations = [], t = 0;
    scans.forEach(function (s, k) {
      starts.push(t);
      durations.push(s.seconds);
      t += s.seconds;
      var src = tracks[k];
      s.frames.forEach(function (f) { out.set(src.subarray(f[0], f[1]), pos); pos += f[1] - f[0]; });
    });
    return { bytes: out, starts: starts, durations: durations, total: t, format: describe(a) };
  }

  var api = { scan: scan, join: join };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Mp3Join = api;
})(this);
