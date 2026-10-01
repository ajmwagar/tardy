import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "../bin/tardy-news.mjs");
const skill = path.resolve(here, "../../../skills/tardy/SKILL.md");

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    input: options.input,
  });
}

test("installs the canonical skill", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tardy-skill-test-"));
  const result = run(["install", "--source", skill, "--dir", directory]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(path.join(directory, "SKILL.md"), "utf8"), /^---\nname: tardy\n/);
});

test("verifies exact webhook bytes without printing the secret", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tardy-webhook-test-"));
  const state = path.join(directory, "agent.json");
  const secret = "test-secret-that-must-not-be-printed";
  const body = Buffer.from('{"event":"work_message"}\n');
  await writeFile(state, JSON.stringify({ webhook_secret: secret }), { mode: 0o600 });
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  const valid = run(["verify-webhook", "--state", state, "--signature", signature], { input: body, encoding: null });
  assert.equal(valid.status, 0, valid.stderr?.toString());
  assert.deepEqual(valid.stdout, body);
  assert.doesNotMatch(valid.stdout.toString(), new RegExp(secret));

  const invalid = run(["verify-webhook", "--state", state, "--signature", `sha256=${"0".repeat(64)}`], { input: body });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /signature is invalid/);
  assert.equal((await stat(state)).mode & 0o777, 0o600);
});
