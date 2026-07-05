/**
 * source-label — unique, still-group-able labels for indexed execution output.
 *
 * Every ctx_execute / ctx_execute_file indexes its output under a source label.
 * A fixed label like "execute:shell:diagnostics" collides across invocations, so
 * ctx_search(source: …) mixes unrelated runs together. We append a per-process
 * seed plus a monotonic counter: the base stays a PREFIX of the label (so a
 * partial-match ctx_search on the base still groups every run) while each run
 * also gets a precise, unique handle for exact retrieval.
 *
 * The seed is derived once at module load so labels stay unique across server
 * restarts that reuse the same persistent store.
 */

const SEED = Date.now().toString(36);
let seq = 0;

/** Return a unique label `<base>#<seed><n>` — `base` is always a prefix. */
export function uniqueSourceLabel(base: string): string {
  seq += 1;
  return `${base}#${SEED}${seq.toString(36)}`;
}
