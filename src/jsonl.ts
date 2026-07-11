/**
 * jsonl — detect newline-delimited JSON so ctx_index chunks it by whole events.
 *
 * The default index path chunks by markdown headings, which is wrong for a JSONL
 * agent-eval trace: it has no headings, and heading/paragraph splitting can cut
 * an event across a chunk boundary so ctx_search returns half a JSON object.
 * Routing JSONL to the line-group chunker keeps each event intact.
 *
 * Detection is deliberately conservative: a `.jsonl`/`.ndjson` path is enough,
 * otherwise a spread sample of non-empty lines must EACH be a standalone JSON
 * value. A pretty-printed single JSON document fails (its lines don't parse
 * alone), and prose/markdown fails (lines aren't JSON) — so neither is
 * misclassified.
 */

/** True when `text` (or `path`) is newline-delimited JSON. */
export function looksLikeJSONL(text: string, path: string | undefined): boolean {
  if (path && /\.(jsonl|ndjson)$/i.test(path)) return true;

  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false; // one line = a single JSON value, not JSONL

  // Sample spread across the file so a JSON-looking preamble can't fool us.
  const positions = [
    0,
    Math.floor(lines.length / 4),
    Math.floor(lines.length / 2),
    Math.floor((3 * lines.length) / 4),
    lines.length - 1,
  ];
  const sample = [...new Set(positions)].map((i) => lines[i].trim());

  for (const line of sample) {
    if (line[0] !== "{" && line[0] !== "[") return false;
    try {
      JSON.parse(line);
    } catch {
      return false;
    }
  }
  return true;
}
