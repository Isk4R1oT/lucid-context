import { capBytes, charSafePrefix } from "./truncate.js";

export const OUTPUT_MODES = ["auto", "diagnostics", "compact", "full", "index"] as const;
export type OutputMode = (typeof OUTPUT_MODES)[number];

export interface DiagnosticSummaryInput {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  timedOut?: boolean;
  sourceLabel?: string;
}

export interface DiagnosticSummaryOptions {
  contextLines?: number;
  maxWindows?: number;
  maxBytes?: number;
}

interface StreamLine {
  stream: "stdout" | "stderr";
  index: number;
  text: string;
}

interface WindowRange {
  stream: "stdout" | "stderr";
  start: number;
  end: number;
}

const DEFAULT_CONTEXT_LINES = 2;
const DEFAULT_MAX_WINDOWS = 24;
const DEFAULT_MAX_BYTES = 16_000;

const ERROR_RE = /\b(error|fatal|panic|exception|traceback|syntaxerror|typeerror|referenceerror|assertionerror|compilation failed|cannot find|not found|denied|eacces|enoent|err!)\b|error\s+ts\d{3,5}\b/i;
const WARNING_RE = /\b(warn|warning|deprecated|deprecation)\b/i;
const FAILURE_RE = /\b(fail|failed|failure|failing|✗|×)\b/i;
const TEST_SUMMARY_RE = /\b(tests?|specs?|suites?)\b.*\b(failed|passed|skipped|total)\b/i;

function stripAnsi(line: string): string {
  return line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function splitLines(stream: "stdout" | "stderr", text: string | undefined): StreamLine[] {
  if (!text) return [];
  return text.replace(/\r\n/g, "\n").split("\n").map((line, index) => ({
    stream,
    index,
    text: stripAnsi(line),
  }));
}

function isDiagnosticLine(line: string): boolean {
  return ERROR_RE.test(line)
    || WARNING_RE.test(line)
    || FAILURE_RE.test(line)
    || TEST_SUMMARY_RE.test(line);
}

function mergeRanges(ranges: WindowRange[]): WindowRange[] {
  const byStream: Record<"stdout" | "stderr", WindowRange[]> = {
    stdout: [],
    stderr: [],
  };
  for (const range of ranges) byStream[range.stream].push(range);

  const merged: WindowRange[] = [];
  for (const stream of ["stdout", "stderr"] as const) {
    const sorted = byStream[stream].sort((a, b) => a.start - b.start);
    for (const range of sorted) {
      const prev = merged.at(-1);
      if (prev && prev.stream === stream && range.start <= prev.end + 1) {
        prev.end = Math.max(prev.end, range.end);
      } else {
        merged.push({ ...range });
      }
    }
  }
  return merged;
}

function countMatches(lines: StreamLine[], rx: RegExp): number {
  return lines.reduce((count, line) => count + (rx.test(line.text) ? 1 : 0), 0);
}

const FALLBACK_LINE_WIDTH = 200;

// Cap one rendered line so a single very long line (a minified bundle, a
// one-line JSON payload) cannot fill the whole byte budget with a signal-free
// prefix. The full line stays retrievable via the indexed source.
function truncateSampleLine(text: string): string {
  if (text.length <= FALLBACK_LINE_WIDTH) return text;
  const prefix = charSafePrefix(text, FALLBACK_LINE_WIDTH);
  return `${prefix}… [+${text.length - prefix.length} chars]`;
}

function formatWindow(lines: StreamLine[], range: WindowRange): string[] {
  const out: string[] = [];
  const selected = lines.slice(range.start, range.end + 1);
  for (const line of selected) {
    const lineNumber = String(line.index + 1).padStart(5, " ");
    out.push(`${line.stream}:${lineNumber}: ${truncateSampleLine(line.text)}`);
  }
  return out;
}

const FALLBACK_HEAD = 6;
const FALLBACK_TAIL = 6;

// Head + tail of a stream, with an explicit gap marker when the middle is
// elided — so a reader is never misled into thinking a tail-only sample is the
// whole picture. A keyword-less needle often sits in the middle; the honest
// signal is "the full output is retrievable", not a fabricated representative slice.
function sampleHeadTail(lines: StreamLine[]): Array<StreamLine | null> {
  if (lines.length <= FALLBACK_HEAD + FALLBACK_TAIL) return [...lines];
  return [...lines.slice(0, FALLBACK_HEAD), null, ...lines.slice(-FALLBACK_TAIL)];
}

function formatFallbackSample(
  stdoutLines: StreamLine[],
  stderrLines: StreamLine[],
  indexed: boolean,
): string[] {
  const stderrSample = stderrLines.slice(0, 10);
  const stdoutSample = sampleHeadTail(stdoutLines);
  if (stderrSample.length === 0 && stdoutSample.length === 0) {
    return ["(no output)"];
  }

  const lines: string[] = [
    "No error/warn/fail lines matched — this does NOT mean nothing here matters.",
    indexed
      ? 'To find specific content: ctx_search(source: …). To read it line by line: re-run with output_mode: "full" (or ctx_read the file).'
      : 'To read it all, re-run with output_mode: "full".',
    "",
    "Sample (head + tail — the middle is NOT shown):",
    "",
  ];
  for (const line of [...stderrSample, ...stdoutSample]) {
    if (line === null) {
      lines.push("       … (middle elided) …");
      continue;
    }
    const lineNumber = String(line.index + 1).padStart(5, " ");
    lines.push(`${line.stream}:${lineNumber}: ${truncateSampleLine(line.text)}`);
  }
  return lines;
}

export function summarizeDiagnostics(
  input: DiagnosticSummaryInput,
  options: DiagnosticSummaryOptions = {},
): string {
  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES;
  const maxWindows = options.maxWindows ?? DEFAULT_MAX_WINDOWS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const stdout = input.stdout ?? "";
  const stderr = input.stderr ?? "";
  const stdoutLines = splitLines("stdout", stdout);
  const stderrLines = splitLines("stderr", stderr);
  const allLines = [...stdoutLines, ...stderrLines];

  const ranges: WindowRange[] = [];
  for (const line of allLines) {
    if (!isDiagnosticLine(line.text)) continue;
    const streamLines = line.stream === "stdout" ? stdoutLines : stderrLines;
    ranges.push({
      stream: line.stream,
      start: Math.max(0, line.index - contextLines),
      end: Math.min(streamLines.length - 1, line.index + contextLines),
    });
  }

  const merged = mergeRanges(ranges).slice(0, maxWindows);
  const totalBytes = Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
  const header = [
    "Diagnostic summary",
    `Exit code: ${input.exitCode ?? 0}${input.timedOut ? " (timed out)" : ""}`,
    `Output: ${stdoutLines.length} stdout lines, ${stderrLines.length} stderr lines, ${(totalBytes / 1024).toFixed(1)}KB`,
    `Signals: ${countMatches(allLines, ERROR_RE)} error lines, ${countMatches(allLines, WARNING_RE)} warning lines, ${countMatches(allLines, FAILURE_RE)} failure lines`,
  ];
  if (input.sourceLabel) {
    header.push(`Full output indexed as source: "${input.sourceLabel}"`);
  }
  header.push("");

  const body: string[] = [];
  if (merged.length > 0) {
    body.push(`Matched diagnostic windows (${merged.length}${ranges.length > merged.length ? ` of ${ranges.length}` : ""}):`);
    body.push("");
    for (const range of merged) {
      body.push(...formatWindow(range.stream === "stdout" ? stdoutLines : stderrLines, range));
      body.push("");
    }
  } else {
    body.push(...formatFallbackSample(stdoutLines, stderrLines, Boolean(input.sourceLabel)));
  }

  const text = [...header, ...body].join("\n").trimEnd();
  return capBytes(text, maxBytes);
}
