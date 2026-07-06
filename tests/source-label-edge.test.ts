import { describe, expect, test } from "vitest";
import { uniqueSourceLabel } from "../src/source-label.js";

describe("uniqueSourceLabel — production invariants", () => {
  test("5000 calls are all distinct", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(uniqueSourceLabel("execute:shell:diagnostics"));
    expect(seen.size).toBe(5000);
  });

  test("base is always a strict prefix so partial-match grouping holds", () => {
    for (const base of [
      "execute:shell:diagnostics",
      "file:/a/b.csv",
      "execute:python:error",
      "weird base#already-hashed",
    ]) {
      expect(uniqueSourceLabel(base).startsWith(`${base}#`)).toBe(true);
    }
  });

  test("distinct bases never collide and keep their own prefix", () => {
    const a = uniqueSourceLabel("execute:shell:diagnostics");
    const b = uniqueSourceLabel("execute:python:diagnostics");
    expect(a).not.toBe(b);
    expect(a.startsWith("execute:shell:diagnostics#")).toBe(true);
    expect(b.startsWith("execute:python:diagnostics#")).toBe(true);
  });

  test("a base is NOT a prefix of a different base's label (no cross-scope leak)", () => {
    // ctx_search(source: "execute:shell") must not partial-match a python label
    const py = uniqueSourceLabel("execute:python:diagnostics");
    expect(py.startsWith("execute:shell")).toBe(false);
  });
});
