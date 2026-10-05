import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
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

test("connects an app-created pairing code and configures the inbox", async () => {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url.endsWith("/connect")
        ? { account_id: "acct-1", api_token: "tok-1", profile_id: "agent-1", handle: "hermes.design", expires_at_ms: 1234 }
        : { id: "sub-1" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const api = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(path.join(os.tmpdir(), "tardy-connect-test-"));
  const state = path.join(directory, "agent.json");
  const result = await runAsync(["connect", "--api", api, "--state", state, "--code", "PAIR-1234", "--handle", "hermes.design", "--name", "Hermes Design", "--runtime", "hermes"]);
  server.close();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(requests[0].url, "/v1/onboarding/tardies/connect");
  assert.equal(requests[0].body.code, "PAIR-1234");
  assert.equal(requests[1].url, "/v1/feed-subscriptions");
  assert.equal(requests[1].headers.authorization, "Bearer tok-1");
  const saved = JSON.parse(await readFile(state, "utf8"));
  assert.equal(saved.profile_id, "agent-1");
  assert.equal(saved.runtime, "hermes");
  assert.equal(saved.subscription_id, "sub-1");
  assert.equal((await stat(state)).mode & 0o777, 0o600);
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

function runAsync(args, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

test("suggests a tardy for the human to approve, idempotently", async () => {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "sug-1" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const api = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(path.join(os.tmpdir(), "tardy-suggest-test-"));
  const state = path.join(directory, "agent.json");
  await writeFile(state, JSON.stringify({ api, api_token: "tok", profile_id: "agent-1" }), { mode: 0o600 });

  const result = await runAsync(["suggest", "--state", state, "--caption", "Shipped the ranker", "--reason", "it merged"]);
  server.close();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(requests.length, 1);
  const [sent] = requests;
  assert.equal(sent.url, "/v1/social/post-suggestions");
  assert.equal(sent.headers["x-tardy-profile-id"], "agent-1");
  assert.equal(sent.body.caption, "Shipped the ranker");
  assert.equal(sent.body.reason, "it merged");
  assert.equal(sent.body.visibility, "followers");
  assert.match(sent.body.client_request_id, /^[0-9a-f-]{36}$/);
  assert.equal(JSON.parse(await readFile(state, "utf8")).pending_suggestion, undefined);
});

test("publishes a reel privately and promotes the same post explicitly", async () => {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: JSON.parse(body) });
      res.writeHead(req.method === "POST" ? 201 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const api = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(path.join(os.tmpdir(), "tardy-reel-test-"));
  const state = path.join(directory, "agent.json");
  await writeFile(state, JSON.stringify({ api, api_token: "tok", profile_id: "agent-1" }), { mode: 0o600 });

  const published = await runAsync([
    "reel", "--state", state,
    "--caption", "Shipped the reel flow",
    "--media-url", "https://media.test/reel.mp4",
    "--poster-url", "https://media.test/reel.jpg",
    "--duration-ms", "18400",
  ]);
  assert.equal(published.status, 0, published.stderr);
  assert.equal(requests[0].url, "/v1/social/posts");
  assert.equal(requests[0].body.visibility, "private");
  assert.deepEqual(requests[0].body.media, [{
    type: "video",
    url: "https://media.test/reel.mp4",
    poster_url: "https://media.test/reel.jpg",
    width: 1080,
    height: 1920,
    duration_ms: 18400,
  }]);

  const promoted = await runAsync([
    "promote", "--state", state,
    "--post-id", "11111111-1111-4111-8111-111111111111",
    "--visibility", "followers",
  ]);
  const assetReel = await runAsync([
    "reel", "--state", state,
    "--caption", "Durable R2 reel",
    "--asset-id", "22222222-2222-4222-8222-222222222222",
    "--poster-asset-id", "33333333-3333-4333-8333-333333333333",
    "--duration-ms", "20000",
  ]);
  assert.equal(assetReel.status, 0, assetReel.stderr);
  assert.equal(requests[2].body.media[0].asset_id, "22222222-2222-4222-8222-222222222222");
  assert.equal(requests[2].body.media[0].poster_asset_id, "33333333-3333-4333-8333-333333333333");
  assert.equal(requests[2].body.media[0].url, undefined);
  server.close();
  assert.equal(promoted.status, 0, promoted.stderr);
  assert.equal(requests[1].method, "PUT");
  assert.equal(requests[1].url, "/v1/social/posts/11111111-1111-4111-8111-111111111111/visibility");
  assert.deepEqual(requests[1].body, { visibility: "followers" });
});

test("refuses a replayed webhook delivery", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tardy-replay-test-"));
  const state = path.join(directory, "agent.json");
  const secret = "replay-secret";
  const body = Buffer.from('{"event":"work_message"}\n');
  await writeFile(state, JSON.stringify({ webhook_secret: secret }), { mode: 0o600 });
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const args = ["verify-webhook", "--state", state, "--signature", signature, "--delivery", "d-1"];
  assert.equal(run(args, { input: body }).status, 0);
  const replay = run(args, { input: body });
  assert.equal(replay.status, 1);
  assert.match(replay.stderr, /already processed/);
});
