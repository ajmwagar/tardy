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
    cwd: options.cwd,
    env: { ...process.env, TARDY_API_URL: "", ...options.env },
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

test("installs for Claude Code with a secret-free project MCP server", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "tardy-claude-code-test-"));
  const state = path.join(project, "agent.json");
  await writeFile(state, JSON.stringify({ api: "https://api.tardy.test", api_token: "tok-secret", profile_id: "agent-1" }), { mode: 0o600 });
  await writeFile(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { other: { type: "stdio", command: "other" } } }));

  const result = run(["install", "--host", "claude-code", "--source", skill], { cwd: project, env: { TARDY_STATE_PATH: state } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(path.join(project, ".claude/skills/tardy/SKILL.md"), "utf8"), /^---\nname: tardy\n/);
  const config = await readFile(path.join(project, ".mcp.json"), "utf8");
  assert.doesNotMatch(config, /tok-secret/);
  assert.deepEqual(JSON.parse(config).mcpServers, {
    other: { type: "stdio", command: "other" },
    tardy: { type: "http", url: "https://api.tardy.test/mcp", headersHelper: "tardy mcp-headers" },
  });

  const headers = run(["mcp-headers"], { env: { TARDY_STATE_PATH: state } });
  assert.equal(headers.status, 0, headers.stderr);
  assert.deepEqual(JSON.parse(headers.stdout), { Authorization: "Bearer tok-secret", "X-Tardy-Profile-Id": "agent-1" });
});

test("refuses to overwrite a different Claude Code tardy server without --force", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "tardy-claude-code-force-test-"));
  const mine = { type: "http", url: "https://elsewhere.test/mcp" };
  await writeFile(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { tardy: mine } }));
  const env = { TARDY_STATE_PATH: path.join(project, "missing.json") };

  const refused = run(["install", "--host", "claude-code", "--source", skill], { cwd: project, env });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /different "tardy" server/);
  assert.deepEqual(JSON.parse(await readFile(path.join(project, ".mcp.json"), "utf8")).mcpServers.tardy, mine);

  const forced = run(["install", "--host", "claude-code", "--source", skill, "--force"], { cwd: project, env });
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(JSON.parse(await readFile(path.join(project, ".mcp.json"), "utf8")).mcpServers.tardy.url, "https://api.tardy.news/mcp");
});

test("mcp-headers fails loudly before onboarding", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tardy-headers-test-"));
  const result = run(["mcp-headers"], { env: { TARDY_STATE_PATH: path.join(directory, "missing.json") } });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /run `tardy onboard` first/);
});
