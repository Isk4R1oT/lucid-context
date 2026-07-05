import { describe, expect, test } from "vitest";
import { previewMatchLine, rarestQueryTerm } from "../src/preview.js";

const chunk = [
  "request 8875: token=tok_f2ad latency=75 region=us-east-1",
  "request 8876: token=tok_f2b4 latency=76 region=us-east-1",
  "request 8888: token=SECRET_MARKER_a1b2c3 latency=4210 region=eu-west-2",
  "request 8889: token=tok_f30f latency=89 region=us-east-1",
].join("\n");

describe("rarestQueryTerm", () => {
  test("picks the distinctive term over common words", () => {
    const term = rarestQueryTerm("SECRET_MARKER token region latency request", chunk);
    expect(term).toBe("SECRET_MARKER");
  });

  test("returns undefined when no term of length >= 3 occurs", () => {
    expect(rarestQueryTerm("zzz nonexistent", chunk)).toBeUndefined();
  });
});

describe("previewMatchLine", () => {
  test("surfaces the mid-chunk needle line, not the common first line", () => {
    const preview = previewMatchLine(chunk, "SECRET_MARKER token region latency", 160);
    expect(preview).toContain("SECRET_MARKER_a1b2c3");
    expect(preview).toContain("eu-west-2");
    expect(preview).not.toContain("8875");
  });

  test("falls back to the first non-empty line when no term matches", () => {
    const preview = previewMatchLine(chunk, "nomatch here", 160);
    expect(preview).toContain("request 8875");
  });

  test("truncates to maxLen", () => {
    const long = "y".repeat(500);
    expect(previewMatchLine(long, "yy", 100).length).toBeLessThanOrEqual(101);
  });
});
