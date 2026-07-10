import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageFileStream } from "../src/pager.js";

describe("pageFileStream (streaming, any file size)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ctxread-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, content: string): string {
    const p = join(dir, name);
    writeFileSync(p, content);
    return p;
  }

  test("returns the requested window with 1-based line numbers", async () => {
    const p = write("ten.txt", Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n"));
    const r = await pageFileStream(p, 3, 4, 10_000, 4_000);
    expect(r.start).toBe(3);
    expect(r.end).toBe(6);
    expect(r.text).toContain("3: line 3");
    expect(r.text).toContain("6: line 6");
    expect(r.text).not.toContain("line 7");
    expect(r.nextOffset).toBe(7);
  });

  test("signals EOF with nextOffset null", async () => {
    const p = write("five.txt", "a\nb\nc\nd\ne\n");
    const r = await pageFileStream(p, 1, 100, 10_000, 4_000);
    expect(r.end).toBe(5);
    expect(r.nextOffset).toBeNull();
  });

  test("keeps a NON-keyword line diagnostics would drop", async () => {
    const p = write("trace.txt", "step 1 ok\nKEY_DECISION_X7 chose binary search\nstep 3 ok\n");
    const r = await pageFileStream(p, 1, 50, 10_000, 4_000);
    expect(r.text).toContain("KEY_DECISION_X7");
  });

  test("byte budget returns fewer lines and never stalls", async () => {
    const p = write("fat.txt", Array.from({ length: 100 }, (_, i) => `${i}:${"x".repeat(500)}`).join("\n"));
    const r = await pageFileStream(p, 1, 100, 2_000, 4_000);
    expect(r.end).toBeLessThan(100);
    expect(r.nextOffset).toBe(r.end + 1);
    expect(Buffer.byteLength(r.text)).toBeLessThan(2_500);
  });

  test("caps an enormous single line with a marker", async () => {
    const p = write("long.txt", `${"z".repeat(50_000)}\ntail\n`);
    const r = await pageFileStream(p, 1, 1, 100_000, 200);
    expect(r.truncatedLines).toEqual([1]);
    expect(r.text).toContain("chars]");
  });

  test("offset past EOF returns an empty page", async () => {
    const p = write("three.txt", "a\nb\nc\n");
    const r = await pageFileStream(p, 999, 5, 10_000, 4_000);
    expect(r.text).toBe("");
    expect(r.start).toBe(0);
  });

  test("handles CRLF without leaking carriage returns", async () => {
    const p = write("crlf.txt", "one\r\ntwo\r\nthree\r\n");
    const r = await pageFileStream(p, 1, 10, 10_000, 4_000);
    expect(r.text).toContain("two");
    expect(r.text).not.toContain("\r");
  });
});
