# Lucid Context

Context optimization for coding agents.

Lucid Context keeps raw tool output out of the conversation while preserving the
signals agents actually need: errors, warnings, failed tests, build summaries,
and searchable session memory.

This project is based on `mksglu/context-mode` and is being developed as a
separate project with a stronger focus on diagnostic-preserving context
compression and agent-controlled output modes.

## What is different

`ctx_execute` supports explicit output modes:

```text
output_mode: "auto" | "diagnostics" | "compact" | "full" | "index"
```

For builds, tests, compilers, and linters, use:

```text
ctx_execute(language: "shell", code: "npm test", output_mode: "diagnostics")
```

The command runs fully. Full stdout/stderr is indexed. The conversation only
receives diagnostic windows around errors, warnings, failures, and test
summaries.

## Local Development

```bash
pnpm install
pnpm run build
```

Focused checks:

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run tests/output-mode.test.ts
```

## Try in Claude Code from this local checkout

For local testing before publishing a GitHub plugin marketplace, use the local
installer. It writes `mcpServers.lucid-context` and the hook commands into your
Claude Code `settings.json`, using absolute paths to this checkout.

```bash
cd /Users/igor/Documents/ClearOut/lucid-context
pnpm install
pnpm run build
node scripts/install-claude-local.mjs
```

Then in Claude Code:

```text
/reload-plugins
```

Smoke test:

```text
Call ctx_execute with:
language = "shell"
code = "echo start; echo 'WARNING middle diagnostic' >&2; echo done"
output_mode = "diagnostics"
```

Expected: the warning appears in the diagnostic summary even though the command
exits successfully.

To remove the local Claude Code wiring:

```bash
cd /Users/igor/Documents/ClearOut/lucid-context
node scripts/uninstall-claude-local.mjs
```

After publishing the GitHub marketplace, the install should become:

```text
/plugin marketplace add YOUR_GITHUB/lucid-context
/plugin install lucid-context@lucid-context
```

## Try in Codex

After publishing this repository as a Codex plugin:

```bash
codex plugin marketplace add YOUR_GITHUB/lucid-context
codex plugin install lucid-context
```

For MCP-only local testing:

```bash
codex mcp add lucid-context -- node /Users/igor/Documents/ClearOut/lucid-context/start.mjs
```

MCP-only mode exposes the tools, but plugin mode is preferred because hooks and
session routing are what teach the agent when to use diagnostic output.

## Attribution

Lucid Context is based on `mksglu/context-mode`. Original upstream credits are
kept in `docs/UPSTREAM-CREDITS.md` where applicable.
