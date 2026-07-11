import { describe, expect, test } from "vitest";
import { looksLikeJSONL } from "../src/jsonl.js";

const jsonlTrace = Array.from({ length: 50 }, (_, i) =>
  JSON.stringify({ i, type: i % 2 ? "tool_use" : "assistant", text: `step ${i}` }),
).join("\n");

describe("looksLikeJSONL", () => {
  test("detects a JSONL trace by content", () => {
    expect(looksLikeJSONL(jsonlTrace, undefined)).toBe(true);
  });

  test("trusts a .jsonl / .ndjson path extension", () => {
    expect(looksLikeJSONL("anything\nnot json", "/x/run.jsonl")).toBe(true);
    expect(looksLikeJSONL("whatever", "/x/log.ndjson")).toBe(true);
  });

  test("rejects prose / markdown", () => {
    expect(looksLikeJSONL("# Title\n\nSome prose.\n\n- item\n- item\n", undefined)).toBe(false);
  });

  test("rejects a pretty-printed single JSON document", () => {
    expect(looksLikeJSONL(JSON.stringify({ a: 1, b: { c: 2 }, d: [1, 2, 3] }, null, 2), undefined)).toBe(false);
  });

  test("rejects a single minified JSON line (one value, not JSONL)", () => {
    expect(looksLikeJSONL('{"a":1,"b":2}', undefined)).toBe(false);
  });

  test("rejects when a sampled line is not standalone JSON", () => {
    const lines = Array.from({ length: 20 }, (_, i) => JSON.stringify({ i }));
    lines[10] = "this is not json";
    expect(looksLikeJSONL(lines.join("\n"), undefined)).toBe(false);
  });

  test("tolerates blank lines between events", () => {
    expect(looksLikeJSONL(jsonlTrace.split("\n").join("\n\n"), undefined)).toBe(true);
  });
});
