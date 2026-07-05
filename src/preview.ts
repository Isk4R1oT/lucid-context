/**
 * preview — pick a compact, informative preview line for an indexed chunk.
 *
 * The intent-mode response lists matched chunks with a one-line preview. A
 * naive "first line of the chunk" preview hides the real hit when the match is
 * buried mid-chunk (e.g. a needle line inside a large log). These helpers
 * anchor the preview on the RAREST matched query term, so a distinctive needle
 * (which occurs once) wins over common words that match every line.
 */

/**
 * Return the query term with the fewest — but non-zero — occurrences in
 * `content`, preserving its original case. Terms shorter than 3 chars are
 * ignored. Returns undefined when no term of length >= 3 occurs in the content.
 */
export function rarestQueryTerm(query: string, content: string): string | undefined {
  const lowerContent = content.toLowerCase();
  const terms = query.split(/\s+/).filter((t) => t.length >= 3);
  let best: string | undefined;
  let bestCount = Infinity;
  for (const term of terms) {
    const needle = term.toLowerCase();
    let count = 0;
    let idx = lowerContent.indexOf(needle);
    while (idx !== -1) {
      count++;
      idx = lowerContent.indexOf(needle, idx + needle.length);
    }
    if (count > 0 && count < bestCount) {
      bestCount = count;
      best = term;
    }
  }
  return best;
}

/**
 * Return a single compact preview line for `content`, anchored on the rarest
 * matched query term so a mid-chunk needle stays visible. Falls back to the
 * first non-empty line. The result is trimmed and truncated to `maxLen` chars.
 */
export function previewMatchLine(content: string, query: string, maxLen: number): string {
  const lines = content.split("\n");
  const cap = (line: string): string =>
    line.length > maxLen ? `${line.slice(0, maxLen)}…` : line;

  const term = rarestQueryTerm(query, content);
  if (term) {
    const needle = term.toLowerCase();
    const hit = lines.find((line) => line.toLowerCase().includes(needle));
    if (hit) return cap(hit.trim());
  }

  const first = lines.find((line) => line.trim().length > 0) ?? "";
  return cap(first.trim());
}
