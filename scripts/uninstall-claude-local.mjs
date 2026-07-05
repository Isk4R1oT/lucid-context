#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const configDir = process.env.CLAUDE_CONFIG_DIR
  ? resolve(process.env.CLAUDE_CONFIG_DIR)
  : resolve(homedir(), ".claude");
const settingsPath = resolve(configDir, "settings.json");
const backupPath = `${settingsPath}.lucid-context-uninstall-bak-${Date.now()}`;

function stripJsonComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

if (!existsSync(settingsPath)) {
  console.log(`No Claude Code settings found: ${settingsPath}`);
  process.exit(0);
}

const settings = JSON.parse(stripJsonComments(readFileSync(settingsPath, "utf8")));
copyFileSync(settingsPath, backupPath);

if (settings.mcpServers && typeof settings.mcpServers === "object") {
  delete settings.mcpServers["lucid-context"];
}

if (settings.hooks && typeof settings.hooks === "object") {
  for (const eventName of Object.keys(settings.hooks)) {
    if (!Array.isArray(settings.hooks[eventName])) continue;
    settings.hooks[eventName] = settings.hooks[eventName].filter((entry) =>
      !entry.hooks?.some((hook) =>
        typeof hook.command === "string" && hook.command.includes("/lucid-context/hooks/")
      )
    );
    if (settings.hooks[eventName].length === 0) delete settings.hooks[eventName];
  }
}

writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");

console.log(`Lucid Context local Claude Code config removed: ${settingsPath}`);
console.log(`Backup: ${backupPath}`);
console.log("Restart Claude Code or run /reload-plugins.");
