import { describe, expect, test } from "vitest";
import { previewMatchLine, rarestQueryTerm } from "../src/preview.js";

// A lone (unpaired) UTF-16 surrogate is invalid Unicode; strict JSON consumers
// (e.g. the host LLM API receiving a tool_result) reject it.
function hasLoneSurrogate(s: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

describe("rarestQueryTerm — edge cases", () => {
  test("empty query returns undefined", () => {
    expect(rarestQueryTerm("", "some content")).toBeUndefined();
  });

  test("empty content returns undefined", () => {
    expect(rarestQueryTerm("token region", "")).toBeUndefined();
  });

  test("ignores terms shorter than 3 chars", () => {
    expect(rarestQueryTerm("a bb cc", "a bb cc a bb")).toBeUndefined();
  });

  test("is case-insensitive on both sides, preserves original case", () => {
    expect(rarestQueryTerm("SECRET_marker", "here is secret_MARKER once")).toBe("SECRET_marker");
  });

  test("breaks ties by first term in query order", () => {
    expect(rarestQueryTerm("alpha omega", "x alpha y omega z")).toBe("alpha");
  });

  test("counts non-overlapping occurrences (rarer term wins)", () => {
    // 'aaa' occurs twice non-overlapping in 'aaaaaa'; 'bbb' once → bbb is rarer
    expect(rarestQueryTerm("aaa bbb", "aaaaaa bbb")).toBe("bbb");
  });

  test("treats query terms literally — no regex injection", () => {
    expect(rarestQueryTerm("a.* zzz", "literal a.* substring here")).toBe("a.*");
  });
});

describe("previewMatchLine — edge cases", () => {
  test("empty content returns empty string", () => {
    expect(previewMatchLine("", "token", 100)).toBe("");
  });

  test("single line without newline is returned", () => {
    expect(previewMatchLine("just one line about tokens", "tokens", 100)).toContain("tokens");
  });

  test("skips whitespace-only lines in fallback", () => {
    const content = "   \n\t\nreal content line\n";
    expect(previewMatchLine(content, "nomatch", 100)).toBe("real content line");
  });

  test("finds the needle across CRLF-terminated lines and trims the CR", () => {
    const content = "noise one\r\nNEEDLE_9 here\r\nnoise two\r\n";
    const p = previewMatchLine(content, "NEEDLE_9 token region", 100);
    expect(p).toContain("NEEDLE_9");
    expect(p).not.toContain("\r");
  });

  test("caps at maxLen without splitting a surrogate pair (JSON round-trips)", () => {
    const line = `${"a".repeat(199)}😀 trailing`;
    const p = previewMatchLine(line, "trailing", 200);
    expect(hasLoneSurrogate(p)).toBe(false);
    expect(() => JSON.parse(JSON.stringify(p))).not.toThrow();
  });

  test("never emits a lone surrogate for emoji-dense input", () => {
    const line = `${"😀".repeat(300)} marker_z`;
    const p = previewMatchLine(line, "marker_z", 200);
    expect(hasLoneSurrogate(p)).toBe(false);
  });
});

// Deterministic property fuzz: a unique needle buried in random noise must
// always surface in the preview.
describe("previewMatchLine — deterministic fuzz", () => {
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => ((s = (1103515245 * s + 12345) >>> 0) / 0xffffffff);
  }

  test("200 randomized chunks each surface their unique needle", () => {
    const rnd = lcg(20260706);
    for (let i = 0; i < 200; i++) {
      const nLines = 3 + Math.floor(rnd() * 20);
      const needleLine = Math.floor(rnd() * nLines);
      const needle = `NDL${i}x${Math.floor(rnd() * 1e6).toString(36)}`;
      const lines: string[] = [];
      for (let j = 0; j < nLines; j++) {
        lines.push(
          j === needleLine
            ? `row ${j} token=${needle} region=z latency=${j}`
            : `row ${j} token=tok_${j} region=a latency=${j}`,
        );
      }
      const preview = previewMatchLine(lines.join("\n"), `${needle} token region latency`, 200);
      expect(preview).toContain(needle);
    }
  });
});
