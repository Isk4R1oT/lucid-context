import { describe, expect, test } from "vitest";
import { uniqueSourceLabel } from "../src/source-label.js";

describe("uniqueSourceLabel", () => {
  test("keeps the base as a prefix so partial-match search still groups runs", () => {
    expect(uniqueSourceLabel("execute:shell:diagnostics")).toMatch(/^execute:shell:diagnostics#/);
  });

  test("returns a distinct label on every call", () => {
    const a = uniqueSourceLabel("execute:shell:diagnostics");
    const b = uniqueSourceLabel("execute:shell:diagnostics");
    expect(a).not.toBe(b);
  });
});
