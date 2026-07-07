import { describe, expect, test } from "vitest";
import { pageLines } from "../src/pager.js";

function hasLoneSurrogate(s: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

const ten = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");

describe("pageLines", () => {
  test("returns the requested window in full with line numbers", () => {
    const p = pageLines(ten, 3, 4, 10_000, 4_000);
    expect(p.start).toBe(3);
    expect(p.end).toBe(6);
    expect(p.total).toBe(10);
    expect(p.text).toContain("3: line 3");
    expect(p.text).toContain("6: line 6");
    expect(p.text).not.toContain("line 7");
  });

  test("nextOffset points past the page, null at EOF", () => {
    expect(pageLines(ten, 1, 4, 10_000, 4_000).nextOffset).toBe(5);
    expect(pageLines(ten, 9, 5, 10_000, 4_000).nextOffset).toBeNull();
  });

  test("keeps NON-keyword lines that diagnostics would drop", () => {
    const trace = ["step 1 ok", "KEY_DECISION_X7 chose binary search", "step 3 ok"].join("\n");
    expect(pageLines(trace, 1, 50, 10_000, 4_000).text).toContain("KEY_DECISION_X7");
  });

  test("byte budget returns fewer lines and never stalls", () => {
    const fat = Array.from({ length: 100 }, (_, i) => `${i}:${"x".repeat(500)}`).join("\n");
    const p = pageLines(fat, 1, 100, 2_000, 4_000);
    expect(p.end).toBeLessThan(100);
    expect(p.nextOffset).toBe(p.end + 1);
    expect(Buffer.byteLength(p.text)).toBeLessThan(2_500);
  });

  test("always yields at least one line even if it exceeds the budget", () => {
    const p = pageLines("z".repeat(50_000), 1, 100, 1_000, 60_000);
    expect(p.start).toBe(1);
    expect(p.end).toBe(1);
  });

  test("caps an enormous single line with a marker, no surrogate split", () => {
    const p = pageLines("😀".repeat(5_000), 1, 10, 100_000, 200);
    expect(p.truncatedLines).toEqual([1]);
    expect(p.text).toContain("chars]");
    expect(hasLoneSurrogate(p.text)).toBe(false);
  });

  test("empty file is reported, not crashed", () => {
    const p = pageLines("", 1, 10, 10_000, 4_000);
    expect(p.total).toBe(0);
    expect(p.text).toContain("empty");
    expect(p.nextOffset).toBeNull();
  });

  test("offset past EOF clamps to the last line", () => {
    const p = pageLines(ten, 999, 5, 10_000, 4_000);
    expect(p.start).toBe(10);
    expect(p.end).toBe(10);
    expect(p.nextOffset).toBeNull();
  });

  test("does not report a phantom trailing blank line", () => {
    expect(pageLines("a\nb\n", 1, 10, 10_000, 4_000).total).toBe(2);
  });
});
