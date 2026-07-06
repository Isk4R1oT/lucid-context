import { describe, expect, test } from "vitest";
import { summarizeDiagnostics } from "../src/output-mode.js";

function hasLoneSurrogate(s: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

describe("summarizeDiagnostics — adversarial", () => {
  test("empty output yields a summary without throwing", () => {
    const s = summarizeDiagnostics({ stdout: "", stderr: "", exitCode: 0 });
    expect(s).toContain("Exit code: 0");
  });

  test("propagates a non-zero exit code and the timeout flag", () => {
    const s = summarizeDiagnostics({ stdout: "", stderr: "boom", exitCode: 137, timedOut: true });
    expect(s).toContain("Exit code: 137 (timed out)");
  });

  test("strips ANSI escapes from matched diagnostic lines", () => {
    const s = summarizeDiagnostics({ stdout: "[31mERROR: red failure here[0m", exitCode: 1 });
    expect(s).toContain("ERROR: red failure here");
    expect(s).not.toContain("[31m");
  });

  test("normalizes CRLF so no carriage return leaks into a window", () => {
    const stdout = "line before\r\nERROR: crlf failure\r\nline after\r\n";
    const s = summarizeDiagnostics({ stdout, exitCode: 1 });
    expect(s).toContain("ERROR: crlf failure");
    expect(s).not.toContain("\r");
  });

  test("caps a single huge NON-matching line — no raw dump, stays tiny", () => {
    const s = summarizeDiagnostics({
      stdout: "x".repeat(500_000),
      exitCode: 0,
      sourceLabel: "execute:shell:diagnostics",
    });
    expect(s).toContain("No diagnostic lines matched");
    expect(s).toContain("chars]");
    expect(Buffer.byteLength(s)).toBeLessThan(2_000);
  });

  test("caps a single huge MATCHING line — matched window is truncated too", () => {
    const s = summarizeDiagnostics({ stdout: `error: ${"y".repeat(500_000)}`, exitCode: 1 });
    expect(s).toContain("Matched diagnostic windows");
    expect(s).toContain("chars]");
    expect(Buffer.byteLength(s)).toBeLessThan(2_000);
  });

  test("honors the byte cap even with hundreds of matched errors", () => {
    const stdout = Array.from({ length: 400 }, (_, i) => `error TS${i}: type mismatch on line ${i}`).join("\n");
    const s = summarizeDiagnostics({ stdout, exitCode: 2 }, { maxBytes: 1_500 });
    expect(Buffer.byteLength(s)).toBeLessThanOrEqual(1_500);
  });

  test("no lone surrogate when a huge emoji line is truncated (JSON-safe)", () => {
    const s = summarizeDiagnostics({ stdout: "😀".repeat(5_000), exitCode: 0, sourceLabel: "src" });
    expect(hasLoneSurrogate(s)).toBe(false);
    expect(() => JSON.parse(JSON.stringify(s))).not.toThrow();
  });

  test("surfaces a mid-stream error and a late warning together", () => {
    const lines = Array.from({ length: 500 }, (_, i) =>
      i === 100 ? "ERROR: db pool exhausted" : i === 400 ? "WARN: disk 92%" : `INFO ok ${i}`);
    const s = summarizeDiagnostics({ stdout: lines.join("\n"), exitCode: 0 });
    expect(s).toContain("ERROR: db pool exhausted");
    expect(s).toContain("WARN: disk 92%");
    expect(s).toContain("1 error lines");
    expect(s).toContain("1 warning lines");
  });

  test("keeps a matched window from stderr even when stdout is clean", () => {
    const s = summarizeDiagnostics({
      stdout: "build step 1 ok\nbuild step 2 ok\n",
      stderr: "deprecation warning: use signJWT",
      exitCode: 0,
    });
    expect(s).toContain("deprecation warning: use signJWT");
    expect(s).toContain("1 warning lines");
  });
});
