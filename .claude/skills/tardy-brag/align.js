// Word timings for karaoke captions, from the script text and the clip's own loudness.
//
// Whisper's word times drift badly on synthetic voices (a 2.4 s line can come back with four
// words crammed into its last 0.4 s), so captions don't use them. Instead:
//   1. find the speech bursts in the clip (loudness above a threshold, short dips merged),
//   2. split the script into phrases at punctuation,
//   3. give each phrase a burst (merging the closest bursts while there are more bursts than
//      phrases), and spread its words across the burst by spoken length.
// If there are fewer bursts than phrases, the words are spread over all speech time, gaps skipped.
// Pure and deterministic: same text and loudness in, same timings out.
//
// Whisper is still used where it is sane: if opts.hint holds whisper's words (same count as the
// script) and a phrase's whisper times sit inside that phrase's burst, those times win.
//
// alignWords(text, rms, {fps, threshold, minGap, hint}) -> [[word, start, end], ...] in clip seconds.
// rms is dBFS per frame (voice-prep.sh writes it at 30 fps); hint is [[text, start, end], ...].
(function (root) {
  function speechSegments(rms, fps, threshold, minGap) {
    const segs = [];
    let cur = null;
    rms.forEach((db, i) => {
      if (db <= threshold) return;
      const t = i / fps;
      if (cur && t - cur[1] <= minGap) cur[1] = t + 1 / fps;
      else segs.push((cur = [t, t + 1 / fps]));
    });
    return segs.filter((s) => s[1] - s[0] >= 0.06);
  }

  // Rough spoken length: letters, with digits counted as the longer words they're read as.
  function weight(word) {
    const letters = word.replace(/[^\p{L}\p{N}']/gu, "");
    const digits = (word.match(/\d/g) || []).length;
    return Math.max(2, letters.length + digits * 3);
  }

  function spread(words, a, b) {
    const total = words.reduce((n, w) => n + weight(w), 0);
    let t = a;
    return words.map((w) => {
      const d = ((b - a) * weight(w)) / total;
      const r = [w, t, t + d];
      t += d;
      return r;
    });
  }

  function alignWords(text, rms, opts = {}) {
    const fps = opts.fps ?? 30;
    const words = text.split(" ").filter(Boolean);
    let segs = speechSegments(rms, fps, opts.threshold ?? -40, opts.minGap ?? 0.12);
    if (!segs.length) return spread(words, 0, rms.length / fps);

    const phrases = [];
    let cur = [];
    for (const w of words) {
      cur.push(w);
      if (/[.,!?;:]$/.test(w)) {
        phrases.push(cur);
        cur = [];
      }
    }
    if (cur.length) phrases.push(cur);

    while (segs.length > phrases.length) {
      let k = 0;
      let gap = Infinity;
      for (let i = 0; i < segs.length - 1; i++) {
        const g = segs[i + 1][0] - segs[i][1];
        if (g < gap) [gap, k] = [g, i];
      }
      segs.splice(k, 2, [segs[k][0], segs[k + 1][1]]);
    }
    // More phrases than bursts: join phrases where the voice is least likely to pause (after a
    // comma before after a full stop), shorter pairs first.
    const strength = (p) => (/,$/.test(p[p.length - 1]) ? 1 : /[;:]$/.test(p[p.length - 1]) ? 2 : 3);
    while (phrases.length > segs.length && phrases.length > 1) {
      let k = 0;
      let best = Infinity;
      for (let i = 0; i < phrases.length - 1; i++) {
        const cost = strength(phrases[i]) * 1000 + phrases[i].length + phrases[i + 1].length;
        if (cost < best) [best, k] = [cost, i];
      }
      if (strength(phrases[k]) > 1) break; // only commas are safe to join; otherwise fall through
      phrases.splice(k, 2, phrases[k].concat(phrases[k + 1]));
    }
    if (segs.length === phrases.length) {
      const hint = opts.hint && opts.hint.length === words.length ? opts.hint : null;
      let at = 0;
      return phrases.flatMap((p, i) => {
        const [a, b] = segs[i];
        const h = hint && hint.slice(at, at + p.length);
        at += p.length;
        const sane = h && h.every(([, s, e]) => s >= a - 0.1 && e <= b + 0.15 && e - s >= 0.06);
        return sane ? p.map((w, j) => [w, Math.max(a, h[j][1]), Math.min(b, h[j][2])]) : spread(p, a, b);
      });
    }

    // Still fewer bursts than phrases: lay all words along speech time only, then map back to clip time.
    const speech = segs.reduce((n, s) => n + (s[1] - s[0]), 0);
    const toClip = (x) => {
      for (const [a, b] of segs) {
        if (x <= b - a) return a + x;
        x -= b - a;
      }
      return segs[segs.length - 1][1];
    };
    return spread(words, 0, speech).map(([w, a, b]) => [w, toClip(a), toClip(Math.max(a, b - 1e-6))]);
  }

  root.alignWords = alignWords;
  if (typeof module !== "undefined") module.exports = { alignWords };
})(typeof window !== "undefined" ? window : globalThis);
