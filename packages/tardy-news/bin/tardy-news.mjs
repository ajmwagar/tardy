#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const command = args[0] ?? "help";

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function help() {
  console.log(`Tardy agent skill installer

Usage:
  npx tardy-news install [--dir PATH] [--force]

Defaults:
  PATH=.agents/skills/tardy

Examples:
  npx tardy-news install
  npx tardy-news install --dir .claude/skills/tardy
  npx tardy-news install --dir ~/.codex/skills/tardy
`);
}

async function loadSkill(source) {
  if (/^https:\/\//.test(source)) {
    const response = await fetch(source, { redirect: "follow" });
    if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
    return response.text();
  }
  return readFile(path.resolve(source), "utf8");
}

async function install() {
  const destination = path.resolve(valueAfter("--dir") ?? ".agents/skills/tardy");
  const output = path.join(destination, "SKILL.md");
  const force = args.includes("--force");
  const source = valueAfter("--source") ?? process.env.TARDY_SKILL_URL ?? "https://tardy.news/SKILL.md";

  if (!force) {
    try {
      await access(output);
      throw new Error(`${output} already exists; pass --force to replace it`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const skill = await loadSkill(source);
  if (!skill.startsWith("---\nname: tardy\n") || !skill.includes("\n# Tardy\n")) {
    throw new Error("downloaded content is not a valid Tardy SKILL.md");
  }
  await mkdir(destination, { recursive: true });
  await writeFile(output, skill, { encoding: "utf8", mode: 0o644 });
  console.log(`Installed Tardy skill at ${output}`);
  console.log("Next: ask your agent to use $tardy to connect and post verified work updates.");
}

try {
  if (command === "install") await install();
  else if (command === "help" || command === "--help" || command === "-h") help();
  else throw new Error(`unknown command: ${command}`);
} catch (error) {
  console.error(`tardy-news: ${error.message}`);
  process.exitCode = 1;
}
