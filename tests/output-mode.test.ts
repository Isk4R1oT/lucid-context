import { describe, expect, test } from "vitest";
import { summarizeDiagnostics } from "../src/output-mode.js";

describe("summarizeDiagnostics", () => {
  test("keeps warning windows from the middle of large stdout", () => {
    const before = Array.from({ length: 80 }, (_, i) => `noise before ${i}`).join("\n");
    const after = Array.from({ length: 80 }, (_, i) => `noise after ${i}`).join("\n");
    const stdout = `${before}\nsrc/app.ts(42,7): warning TS6133: 'x' is declared but never used.\n${after}`;

    const summary = summarizeDiagnostics({ stdout, stderr: "", exitCode: 0 }, { maxBytes: 8_000 });

    expect(summary).toContain("warning TS6133");
    expect(summary).toContain("stdout:");
    expect(summary).not.toContain("noise after 79");
  });

  test("includes stderr diagnostics even when exit code is zero", () => {
    const summary = summarizeDiagnostics({
      stdout: "build completed\n",
      stderr: "WARNING deprecated API used\n",
      exitCode: 0,
    });

    expect(summary).toContain("Exit code: 0");
    expect(summary).toContain("WARNING deprecated API used");
    expect(summary).toContain("1 warning lines");
  });

  test("caps very large summaries", () => {
    const stdout = Array.from(
      { length: 1000 },
      (_, i) => `file${i}.ts: error TS2322: Type 'number' is not assignable to type 'string'.`,
    ).join("\n");

    const summary = summarizeDiagnostics({ stdout, exitCode: 2 }, { maxBytes: 2_000 });

    expect(Buffer.byteLength(summary)).toBeLessThanOrEqual(2_000);
    expect(summary).toContain("Diagnostic summary");
  });

  test("truncates a single very long line in the no-match sample", () => {
    const stdout = "x".repeat(200_000); // one giant line, no diagnostic keyword
    const summary = summarizeDiagnostics({
      stdout,
      exitCode: 0,
      sourceLabel: "execute:shell:diagnostics",
    });

    expect(summary).toContain("No error/warn/fail lines matched");
    expect(summary).toContain("chars]"); // per-line truncation marker
    expect(Buffer.byteLength(summary)).toBeLessThan(2_000); // giant line did not leak
  });

  test("truncates a very long line inside a matched diagnostic window", () => {
    const stdout = `prefix error: ${"y".repeat(200_000)}`;
    const summary = summarizeDiagnostics({ stdout, exitCode: 1 });

    expect(summary).toContain("Matched diagnostic windows");
    expect(summary).toContain("chars]");
    expect(Buffer.byteLength(summary)).toBeLessThan(2_000);
  });
});
