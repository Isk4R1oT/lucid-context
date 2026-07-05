#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configDir = process.env.CLAUDE_CONFIG_DIR
  ? resolve(process.env.CLAUDE_CONFIG_DIR)
  : resolve(homedir(), ".claude");
const settingsPath = resolve(configDir, "settings.json");
const backupPath = `${settingsPath}.lucid-context-bak-${Date.now()}`;

function stripJsonComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function readSettings() {
  if (!existsSync(settingsPath)) return {};
  const raw = readFileSync(settingsPath, "utf8");
  if (!raw.trim()) return {};
  return JSON.parse(stripJsonComments(raw));
}

function hook(command, matcher = "") {
  return {
    matcher,
    hooks: [{ type: "command", command }],
  };
}

function upsertHook(settings, eventName, entry) {
  settings.hooks ??= {};
  const list = Array.isArray(settings.hooks[eventName]) ? settings.hooks[eventName] : [];
  const command = entry.hooks?.[0]?.command;
  const withoutExisting = command
    ? list.filter((existing) => !existing.hooks?.some((h) => h.command === command))
    : list;
  settings.hooks[eventName] = [...withoutExisting, entry];
}

mkdirSync(configDir, { recursive: true });
const settings = readSettings();
if (existsSync(settingsPath)) copyFileSync(settingsPath, backupPath);

settings.mcpServers ??= {};
settings.mcpServers["lucid-context"] = {
  command: "node",
  args: [resolve(repoRoot, "start.mjs")],
};

const pretool = `node ${JSON.stringify(resolve(repoRoot, "hooks/pretooluse.mjs"))}`;
const posttool = `node ${JSON.stringify(resolve(repoRoot, "hooks/posttooluse.mjs"))}`;
const sessionstart = `node ${JSON.stringify(resolve(repoRoot, "hooks/sessionstart.mjs"))}`;
const precompact = `node ${JSON.stringify(resolve(repoRoot, "hooks/precompact.mjs"))}`;
const userprompt = `node ${JSON.stringify(resolve(repoRoot, "hooks/userpromptsubmit.mjs"))}`;
const stop = `node ${JSON.stringify(resolve(repoRoot, "hooks/stop.mjs"))}`;

upsertHook(settings, "PreToolUse", hook(
  pretool,
  "Bash|Read|Grep|WebFetch|Agent|mcp__plugin_lucid-context_lucid-context__ctx_execute|mcp__plugin_lucid-context_lucid-context__ctx_execute_file|mcp__plugin_lucid-context_lucid-context__ctx_batch_execute|mcp__",
));
upsertHook(settings, "PostToolUse", hook(
  posttool,
  "Bash|Read|Write|Edit|NotebookEdit|Glob|Grep|TodoWrite|TaskCreate|TaskUpdate|EnterPlanMode|ExitPlanMode|Skill|Agent|AskUserQuestion|EnterWorktree|mcp__",
));
upsertHook(settings, "SessionStart", hook(sessionstart));
upsertHook(settings, "PreCompact", hook(precompact));
upsertHook(settings, "UserPromptSubmit", hook(userprompt));
upsertHook(settings, "Stop", hook(stop));

writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");

console.log(`Lucid Context local Claude Code config installed: ${settingsPath}`);
if (existsSync(backupPath)) console.log(`Backup: ${backupPath}`);
console.log("Restart Claude Code or run /reload-plugins.");
