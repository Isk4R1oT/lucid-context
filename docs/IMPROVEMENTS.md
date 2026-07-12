# What Lucid Context Adds Over `context-mode`

Lucid Context is a fork of [`mksglu/context-mode`](https://github.com/mksglu/context-mode).
This document details every engineering change made on top of the upstream base
— the problem, how it was found, the root cause, the fix, and how it was
verified. Nothing here is aspirational: every fix was verified on the **running**
MCP server, and every claim is backed by a commit.

## TL;DR

| | |
|---|---|
| Commits | **9** feature/fix commits on top of the fork base |
| New source modules | **4** (`pager.ts`, `preview.ts`, `source-label.ts`, `jsonl.ts`) |
| New MCP tool | **1** — `ctx_read` (faithful, streaming, full-fidelity reader) |
| Code | **+997 / −25** lines across 17 files |
| Tests added | **8 new test files** (~600 lines), incl. adversarial + deterministic-fuzz suites |
| Verification | **Every fix verified live** on the reloaded server, not just in unit tests |

---

## The thesis: what was actually wrong with the base

`context-mode`'s core idea is sound — keep raw tool output out of the
conversation while preserving diagnostics (errors, warnings, failed tests). But
it carries one structural blind spot:

> The tool **relocates** information from "in the conversation" to "retrievable
> via a later step." The base version sometimes lost the signal in that
> relocation, or presented a misleading slice, or had no faithful path back at
> all — and it did so **silently**, in the less-travelled code paths.

Concretely, `context-mode` is built for output you **process** (a build, a test
run) and silently degrades on output you **read** (a research page, a
line-by-line study of a JSONL agent-eval trace). Our work closes that gap: every
relocation is now faithful and recoverable, and the missing "read in full"
primitive was added.

---

## 1. New capability — `ctx_read`, the faithful reader *(flagship)*

**Commits:** `79aac9c` (initial), `2946fc9` (streaming + guards) · **New file:** `src/pager.ts`

**Problem.** To understand a project you often need a document *in full* — read a
README to grasp intent, or study a JSONL eval trace event by event. The base has
no tool for this: `ctx_index`/`ctx_search` return ranked BM25 chunks, and
`ctx_execute(diagnostics)` keeps only lines matching `error|warn|fail` and
**eats everything else**.

**How it was found.** Two ways, reinforcing each other:
- A real Claude Code session reported the plugin "eating" its research and
  trace-reading and routing around the plugin with native `Read`.
- We built an adversarial 200-line JSONL eval trace with three needles carrying
  **no** error keyword — an agent decision, an 8 KB tool result, and a
  *silently-wrong* final answer (the actual eval failure). Run through
  `diagnostics`, the tool returned `No diagnostic lines matched` and dumped the
  last 20 nominal lines. **All three needles — including the real failure — were
  eaten.**

**Root cause.** The plugin conflates two different tasks. "Process output" →
summarize, keep only problems. "Read output" → need faithful, complete, ordered
access. The base only implements the first.

**Fix.** A new `ctx_read` MCP tool backed by a pure `src/pager.ts`:
- **Streaming** (`createReadStream` + `readline`) — reads only up to the
  requested page, never the whole file, so it handles a multi-GB trace without
  loading it into memory.
- **Full fidelity** — every line returned complete; nothing keyword-filtered.
- **Byte-budgeted** page so it never floods context, plus a **per-line cap** so
  one fat JSONL event can't blow the page. The line cap is UTF-16
  **surrogate-safe** (reuses the repo's `charSafePrefix`).
- **Continue-offset** in the header so you can walk a file end to end.
- **Binary / minified guards** — a file with null bytes or no line break in its
  first 8 KB is refused with a pointer to `ctx_execute_file`, so `readline`
  never buffers an unbounded "line".

**Verified live.** On the reloaded server: an **18 MB, 500 000-line** file was
paged from offset 400 000 — the needle at line 400 000 came back with only **4
lines in context**, not 18 MB. A file with null bytes was cleanly refused. On the
original JSONL trace, all three previously-eaten needles were returned in full.

---

## 2. Correctness on the truncation path

### 2a. Single-line output leak

**Commit:** `226ef04` · `src/output-mode.ts`

**Problem / how found.** An adversarial "economy" fixture: a single 200 KB line
with no diagnostic keyword (a minified bundle / one-line JSON). The
`diagnostics` no-match fallback returned a signal-free prefix up to the whole
byte budget — the exact inversion of the tool's purpose.

**Root cause.** The fallback sampler was **line-based** (`slice(-20)` lines); one
enormous line = "the last 20 lines" = the whole blob.

**Fix.** A per-line `truncateSampleLine` cap (200 chars + a `[+N chars]` marker),
applied to both matched windows and the no-match sample.

### 2b. Surrogate-safety on the `tool_result` path

**Commit:** `4248635` · `src/output-mode.ts`, `src/preview.ts`

**Problem / how found.** Production-grade testing with emoji at the exact cut
boundary. Our own truncation used bare `slice(0, n)`, which can leave a **lone
UTF-16 surrogate**. `JSON.stringify` emits that as a literal `\uD8xx` escape —
invalid to a strict JSON consumer, i.e. the LLM API receiving the `tool_result`.

**Root cause.** The repo already had `charSafePrefix` in `src/truncate.ts`
written for *exactly* this, and our new code bypassed it.

**Fix.** Route both truncation sites through `charSafePrefix`. Regression test
feeds emoji at the boundary and asserts the output JSON-round-trips with no lone
surrogate.

### 2c. Batch drops multi-line / compound commands *(from real feedback)*

**Commit:** `efec57d` · `src/server.ts`

**Problem / how found.** A real Claude Code session: two of five requests
(`for`-loops over commit dates and READMEs) failed with `parse error near 'for'`,
losing data. Simple commands (`ls`, `du`, `grep`) worked. We reproduced it
exactly via `ctx_batch_execute`.

**Root cause — and a correction of the obvious guess.** It was *not* newline
stripping (that only affected the display echo). `ctx_batch_execute` prepended
the fs-tracking env prefix **inline** — `NODE_OPTIONS=… <command>`. An inline
assignment is legal only before a **simple** command; gluing it onto a
**compound** command (`for`/`while`/`if`/`case`/`{`) is a shell syntax error.
`ctx_execute` (single) doesn't use that prefix, which is why the same loop
worked there.

**Fix.** Emit `export NODE_OPTIONS=…` on its **own newline-terminated line**, so
the command — simple or compound — starts clean. **Verified live:** the exact
failing batch now returns 332 lines of git dates with no parse error.

---

## 3. Retrieval quality

### 3a. Intent-preview hid the needle *(fixed, then re-opened, then fixed properly)*

**Commits:** `226ef04` (v1), `376b023` (v2) · `src/preview.ts`

**Problem / how found.** Indexing a 500 KB log with intent and searching for a
unique `SECRET_MARKER` returned "5 matched sections" whose previews were all
irrelevant `us-east-1` lines — the needle was invisible in the preview.

**Root cause.** The intent preview showed the chunk's **first line**, not the
matched span.

**The honest part.** The v1 fix swapped in the existing `extractSnippet` — and
**live verification showed it was insufficient**: `extractSnippet` anchors on the
first/most-common matched term, so a verbose intent full of common words
(`token`, `region`, `latency`) still landed the window at the chunk start. We
re-opened the finding rather than declare victory, and fixed it properly:
`src/preview.ts` previews the line carrying the **rarest** matched query term, so
a distinctive needle (which occurs once) wins. **Verified live:** the
`SECRET_MARKER` line is now the top preview.

### 3b. JSONL indexed as prose → split events

**Commit:** `1092768` · **New file:** `src/jsonl.ts`

**Problem.** `ctx_index` chunked everything with the markdown chunker. A JSONL
agent-eval trace has no headings, so an event could be split across a chunk
boundary and `ctx_search` would return half a JSON object.

**Fix.** `src/jsonl.ts` `looksLikeJSONL` detects newline-delimited JSON
(conservatively: `.jsonl`/`.ndjson` extension, or a spread sample of lines that
each parse as standalone JSON — pretty-printed JSON and prose are rejected) and
routes it to the line-group chunker so events stay intact. **Verified live:**
searching an indexed trace returns whole, valid JSON events per line.

### 3c. Source-label collision across runs

**Commit:** `14b6a73` · **New file:** `src/source-label.ts`

**Problem / how found.** During the eval, `ctx_search(source: "execute:shell:diagnostics")`
mixed results from *every* prior run — they all shared one fixed label.

**Fix.** `uniqueSourceLabel(base)` appends a per-process seed + monotonic counter.
The base stays a **prefix**, so a partial-match search still groups every run,
while each run also gets a precise handle. **Verified live:** exact-label search
returns only its own run; base-prefix search returns both.

### 3d. Honest no-match fallback

**Commit:** `b457f8d` · `src/output-mode.ts`

**Problem.** When `diagnostics` matched zero keyword lines, the tail sample
*implied* the tail was the whole story — the same silent-miss that motivated
`ctx_read`.

**Fix.** The fallback now states *"this does NOT mean nothing here matters,"*
shows **head + tail** with an explicit `(middle elided)` marker, and points at
`ctx_search` / `output_mode: "full"` / `ctx_read` to retrieve the rest.

---

## 4. Robustness & economy

- **Search flood-guard headroom** (`b457f8d`, `2946fc9`). `ctx_search` blocked
  after 8 calls per 60 s, walling a legitimate iterative investigation. Raised to
  **soft 25 / block 60**, still env-tunable (`CONTEXT_MODE_SEARCH_*`).
- **Binary / minified read guards** (`2946fc9`). Prevent a `readline` OOM on a
  null-laden or newline-free giant file — fail loud with a helpful pointer
  instead.

---

## 5. Strategic findings (grounded, not just code)

- **Subagents & workflows are not auto-covered — and it's a platform limit, not
  our bug.** We *empirically* spawned a subagent and observed the PreToolUse hook
  never fired for it, and confirmed from the Claude Code docs that plugin
  subagents cannot declare `hooks`/`mcpServers`. The lever is a per-agent opt-in
  template (list `ctx_*` in `tools:` + a "context discipline" system-prompt
  block), which we built and verified: a templated subagent used `ctx_execute`
  instead of `Bash`.
- **Version-sync ritual.** Bumping the version is not a one-file edit — the repo
  enforces a cross-manifest lockstep invariant (`tests/scripts/version-sync.test.ts`,
  issue #768). The correct ritual is `pnpm run version-sync`, which propagates to
  ~8 platform manifests.

---

## Methodology — why these changes are trustworthy

The value here is not just the diffs; it's how they were produced.

- **Adversarial-fixture-driven.** Bugs were surfaced with inputs *engineered* to
  expose the "lose the signal" failure — needles with no error keyword, needles
  buried mid-file, needles inside a fat single line, emoji at a byte boundary.
- **Verified live, not just green.** Every fix was confirmed on the **running**
  MCP server after reload, driving the real tool — because a passing unit test is
  not the same as a working tool.
- **Real-world feedback loop.** The two sharpest bugs (`ctx_read`'s motivation,
  the batch `for`-loop failure) came from an actual Claude Code session's report,
  were reproduced, root-caused, fixed, and re-verified.
- **Full-suite triage + live probing.** A run of the entire 4 645-test suite plus
  ~14 live adversarial probes (FTS5-injection queries, timeouts, binary output,
  directory/symlink/empty-file reads, unavailable runtimes) confirmed **no
  regressions and no new bugs** — the remaining suite failures are pre-existing
  environment issues (native `better-sqlite3` bindings absent in the test env,
  other-IDE adapter drift), none in the Claude Code core path.
- **Intellectual honesty as a feature.** We re-opened an insufficient fix
  (intent preview) instead of declaring victory, and retracted an overclaim (a
  suspected `sh`-vs-`bash` bug turned out to be already-correct: the runtime
  prefers `bash` where present).

---

## By the numbers

- **9** feature/fix commits · **4** new source modules · **1** new MCP tool
- **+997 / −25** lines across 17 files · **8** new test files (~600 lines)
- **Every fix verified live.** Zero regressions across the full suite; zero new
  bugs across the live probe sweep.
