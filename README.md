# Lucid Context

[![version](https://img.shields.io/badge/version-1.0.170-blue)](package.json)
[![tests](https://img.shields.io/badge/tests-4.6k-brightgreen)](tests)
[![license](https://img.shields.io/badge/license-Elastic--2.0-lightgrey)](LICENSE)

Context optimization for coding agents — keep raw tool output out of the
conversation while preserving the signals agents actually need: errors,
warnings, failed tests, build summaries, and searchable session memory.

Lucid Context is a **hardened fork of [`mksglu/context-mode`](https://github.com/mksglu/context-mode)**.
On top of the upstream diagnostic-preserving execution it adds a **faithful,
full-fidelity reader**, **JSONL-aware indexing**, and a set of
correctness/robustness fixes that make it hold up on the edges — every one
**verified on the running server, not just in tests**.

> Full engineering writeup — every problem, how it was found, the root cause, the
> fix, and how it was verified: **[docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md)**.

## Highlights over `context-mode`

- **`ctx_read` — a faithful, streaming reader (new).** Read a file page by page,
  every line **in full** — the counterpart to the summary path. It **streams**
  (never loads the whole file), so it pages a multi-GB JSONL agent-eval trace
  without flooding context. This is the tool for studying traces and reading
  research end to end — exactly where the summary path would silently eat the
  content.
- **Nothing silently eaten.** The diagnostics no-match fallback no longer implies
  the tail is the whole story; it says so, shows head + tail with an elision
  marker, and points at how to retrieve the rest. A keyword-less needle (a
  decision, a *silently-wrong* answer) is preserved and recoverable.
- **JSONL-aware indexing.** `ctx_index` chunks newline-delimited JSON by whole
  events, so `ctx_search` never returns half a JSON object.
- **Correct on the edges.** UTF-16 **surrogate-safe** truncation on the
  `tool_result` path (no invalid JSON to the model), **compound-command** batches
  (`for`/`while`/`if` no longer break), and **unique per-run source labels** (one
  run's search no longer mixes with another's).
- **Doesn't wall you.** Raised `ctx_search` flood-guard headroom so a legitimate
  iterative investigation isn't blocked mid-task.
- **Verified live.** Every fix was confirmed by driving the real tool on the
  reloaded MCP server. Full-suite triage + a live adversarial probe sweep found
  no regressions and no new bugs.

## Tools

| Tool | What it does |
|---|---|
| `ctx_execute` | Run code (shell/js/python/…) in a sandbox; `output_mode` controls what enters context |
| `ctx_read` | **Read a file page by page, every line in full** — faithful, streaming, for study/research |
| `ctx_execute_file` | Run code over a file in the sandbox; only what you print enters context |
| `ctx_search` | BM25/FTS5 search over indexed content **and** auto-captured session memory |
| `ctx_index` | Store content (docs, files, dirs) in the searchable knowledge base |
| `ctx_batch_execute` | Run several commands + query the output in one round trip |
| `ctx_fetch_and_index` | Fetch a URL and index it for later retrieval |
| `ctx_stats` | Context-savings statistics for the session |
| `ctx_doctor` | Diagnose the installation (runtimes, hooks, FTS5) |
| `ctx_purge` | Wipe the knowledge base (destructive) |
| `ctx_upgrade` | Update from GitHub |
| `ctx_insight` | Open the hosted Insight dashboard |

## What the output modes do

`ctx_execute` supports explicit output modes:

```text
output_mode: "auto" | "diagnostics" | "compact" | "full" | "index"
```

For builds, tests, compilers, and linters, use `diagnostics`:

```text
ctx_execute(language: "shell", code: "npm test", output_mode: "diagnostics")
```

The command runs fully. Full stdout/stderr is indexed. The conversation only
receives diagnostic windows around errors, warnings, failures, and test
summaries. When you instead need to **read** output line by line (a research
page, a JSONL trace), use `ctx_read`.

## Install in Claude Code

Claude Code has a native plugin marketplace. Lucid Context is packaged as one
plugin bundle: the MCP server, hooks, and skill instructions. Runtime bundles are
committed, so **no post-install build step is required** for end users.

```bash
/plugin marketplace add Isk4R1oT/lucid-context
/plugin install lucid-context@lucid-context
/reload-plugins
```

Smoke test — the warning must appear even though the command exits `0`:

```text
ctx_execute(language: "shell",
            code: "echo start; echo 'WARNING middle diagnostic' >&2; echo done",
            output_mode: "diagnostics")
```

To uninstall:

```bash
/plugin uninstall lucid-context@lucid-context
/plugin marketplace remove lucid-context
```

## Local development

```bash
pnpm install
pnpm run build
```

Focused checks:

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run tests/output-mode.test.ts tests/pager.test.ts
```

Run the plugin from a local checkout without installing anything:

```bash
claude --plugin-dir /path/to/lucid-context
```

Local marketplace install from a checkout (no GitHub required):

```bash
claude plugin marketplace add /path/to/lucid-context
claude plugin install lucid-context@lucid-context
```

For active development, the Claude plugin manifest intentionally omits a plugin
`version`; Claude Code uses the git commit SHA as the plugin version, so
`claude plugin update lucid-context@lucid-context` picks up new commits.

## Try in Codex

```bash
codex plugin marketplace add Isk4R1oT/lucid-context
codex plugin install lucid-context
```

MCP-only local testing (exposes the tools, but plugin mode is preferred because
hooks and session routing are what teach the agent when to use diagnostic
output):

```bash
codex mcp add lucid-context -- node /path/to/lucid-context/start.mjs
```

## Attribution

Lucid Context is based on [`mksglu/context-mode`](https://github.com/mksglu/context-mode).
Original upstream credits are kept in `docs/UPSTREAM-CREDITS.md` where applicable.
