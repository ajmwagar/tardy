// node --test .claude/skills/tardy-brag/align.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { alignWords } = require("./align.js");

// 30 fps loudness: "#" = speech (-20 dB), "." = silence (-70 dB)
const rms = (s) => [...s].map((c) => (c === "#" ? -20 : -70));

test("one phrase per burst, words spread inside it", () => {
  const r = alignWords("Okay. And the bug?", rms("######......" + "############......"));
  assert.equal(r.length, 4);
  assert.ok(r[0][1] < 0.05 && r[0][2] <= 0.21, "Okay sits in the first burst");
  assert.ok(r[1][1] >= 0.39, "And starts in the second burst, not in the silence");
});

test("commas join phrases when there are fewer bursts than phrases", () => {
  // Heh. | Fine. | Still zero reviews, though.  -> 3 bursts, 4 phrases
  const r = alignWords("Heh. Fine. Still zero reviews, though.", rms(".######......." + "########......" + "##############################"));
  const still = r.find(([w]) => w === "Still");
  assert.ok(still[1] >= 0.9 && still[1] < 1.0, `Still starts with the third burst (got ${still[1]})`);
  assert.ok(r.at(-1)[2] <= 1.95, "though ends inside the clip");
});

test("whisper hint wins when it sits inside the burst, loses when it drifts out", () => {
  const loud = rms("############......" + "############");
  const good = alignWords("one two. three four.", loud, { hint: [["one", 0.0, 0.1], ["two", 0.1, 0.4], ["three", 0.6, 0.75], ["four", 0.75, 1.0]] });
  assert.equal(good[1][1], 0.1);
  const drifted = alignWords("one two. three four.", loud, { hint: [["one", 0.0, 0.3], ["two", 0.3, 0.4], ["three", 0.95, 0.97], ["four", 0.97, 1.0]] });
  assert.ok(drifted[2][1] < 0.7, "a crammed hint falls back to the spread");
});

test("deterministic and ordered", () => {
  const a = alignWords("Pull request number one. 23,000 lines!", rms("##########....#########"));
  assert.deepEqual(a, alignWords("Pull request number one. 23,000 lines!", rms("##########....#########")));
  for (let i = 1; i < a.length; i++) assert.ok(a[i][1] >= a[i - 1][1]);
});
