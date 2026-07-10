/**
 * pager — faithful, byte-budgeted line paging for ctx_read.
 *
 * The diagnostics / summarize path is built for output you PROCESS: it keeps
 * only lines matching error/warn/fail and drops the rest. That is exactly wrong
 * for output you READ in full — a research page, or a line-by-line study of a
 * JSONL agent-eval trace, where the interesting events (a decision, a final
 * answer, a semantically-wrong output) carry no error keyword and would be
 * silently eaten.
 *
 * pageLines returns a contiguous window of lines IN FULL — nothing filtered —
 * bounded by a byte budget so a page never floods context, and by a per-line
 * cap so one enormous line (a fat JSONL event) cannot blow the whole page. It
 * reports where to continue so the reader can walk the file end to end.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { charSafePrefix } from "./truncate.js";

export interface PageResult {
  /** Formatted, line-numbered body — ready to return verbatim. */
  text: string;
  /** 1-based number of the first line shown. */
  start: number;
  /** 1-based number of the last line shown. */
  end: number;
  /** Total lines in the content. */
  total: number;
  /** 1-based offset to pass next to continue, or null at end of file. */
  nextOffset: number | null;
  /** Line numbers whose content was itself capped to fit maxLineChars. */
  truncatedLines: number[];
}

/**
 * Split into logical lines, dropping a single trailing newline's empty tail so
 * a file ending in "\n" does not report a phantom final blank line.
 */
function splitLines(content: string): string[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Return the window [offset, offset+limit) of `content`'s lines, each in full,
 * bounded by `maxBytes` for the page and `maxLineChars` per line. Always yields
 * at least one line (even if it alone exceeds maxBytes) so paging never stalls.
 */
export function pageLines(
  content: string,
  offset: number,
  limit: number,
  maxBytes: number,
  maxLineChars: number,
): PageResult {
  const lines = splitLines(content);
  const total = lines.length;

  if (total === 0) {
    return { text: "(empty file)", start: 0, end: 0, total: 0, nextOffset: null, truncatedLines: [] };
  }

  const start = Math.min(Math.max(1, Math.trunc(offset)), total);
  const width = String(total).length;
  const out: string[] = [];
  const truncatedLines: number[] = [];
  let bytes = 0;
  let lineNo = start;

  while (lineNo <= total && out.length < limit) {
    const raw = lines[lineNo - 1];
    let body = raw;
    if (raw.length > maxLineChars) {
      const prefix = charSafePrefix(raw, maxLineChars);
      body = `${prefix}… [+${raw.length - prefix.length} chars]`;
      truncatedLines.push(lineNo);
    }
    const rendered = `${String(lineNo).padStart(width, " ")}: ${body}`;
    const renderedBytes = Buffer.byteLength(rendered) + 1; // + newline

    // Stop before overflowing the page budget, but always emit at least one line.
    if (out.length > 0 && bytes + renderedBytes > maxBytes) break;

    out.push(rendered);
    bytes += renderedBytes;
    lineNo += 1;
  }

  const end = start + out.length - 1;
  return {
    text: out.join("\n"),
    start,
    end,
    total,
    nextOffset: end < total ? end + 1 : null,
    truncatedLines,
  };
}

export interface StreamPageResult {
  text: string;
  start: number;
  end: number;
  nextOffset: number | null;
  truncatedLines: number[];
}

/**
 * Stream a file and return the window [offset, offset+limit) WITHOUT loading the
 * whole file into memory — so ctx_read works on a multi-GB trace, reading only
 * up to the end of the page and then stopping. Total line count is intentionally
 * NOT computed (that would need a full scan); end-of-file is signalled by
 * nextOffset === null. Callers must pre-screen binary / newline-free giant files
 * (readline would otherwise buffer one unbounded "line").
 */
export async function pageFileStream(
  path: string,
  offset: number,
  limit: number,
  maxBytes: number,
  maxLineChars: number,
): Promise<StreamPageResult> {
  const start = Math.max(1, Math.trunc(offset));
  const out: string[] = [];
  const truncatedLines: number[] = [];
  let bytes = 0;
  let lineNo = 0;
  let nextOffset: number | null = null;

  const input = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const raw of rl) {
      lineNo += 1;
      if (lineNo < start) continue;

      let body = raw;
      if (raw.length > maxLineChars) {
        const prefix = charSafePrefix(raw, maxLineChars);
        body = `${prefix}… [+${raw.length - prefix.length} chars]`;
        truncatedLines.push(lineNo);
      }
      const rendered = `${String(lineNo).padStart(6, " ")}: ${body}`;
      const renderedBytes = Buffer.byteLength(rendered) + 1;

      // Page-budget stop (always emit at least one line so paging never stalls).
      if (out.length > 0 && bytes + renderedBytes > maxBytes) {
        nextOffset = lineNo; // this line did not fit — resume here
        break;
      }
      out.push(rendered);
      bytes += renderedBytes;
      if (out.length >= limit) {
        nextOffset = lineNo + 1; // page full — more may follow
        break;
      }
    }
  } finally {
    rl.close();
    input.destroy();
  }

  return {
    text: out.length > 0 ? out.join("\n") : "",
    start: out.length > 0 ? start : 0,
    end: out.length > 0 ? start + out.length - 1 : 0,
    nextOffset,
    truncatedLines,
  };
}
