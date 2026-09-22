/**
 * §11「把全套测试过滤成零条，runner 必须因 collected/executed 数量为零而失败」的
 * 判据单测（#3008）。
 *
 * 两层各自独立可反证：
 * - `parseExecutedCount`：从日志正文读执行条数，零收集读成 0、认不出就报错；
 * - `parseEvidenceManifest`：`executed >= 1` 与既有三条判据并列。
 * 任何一层的判据被拆掉，这里都有一条会变红。
 */
import { describe, expect, it } from "vitest";
import { parseExecutedCount } from "./executed-count";
import { parseEvidenceManifest } from "./phase-readiness";

const COMMIT = "9".repeat(40);

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    phase: "01",
    kind: "runtime",
    command: "pnpm --filter api exec vitest run tests/kernel",
    exit_code: 0,
    executed: 12,
    commit: COMMIT,
    recorded_at: "2026-09-08T02:04:11.863Z",
    artifacts: ["phases/phase-01-run-a-project/evidence/ci/runtime.log"],
    ...overrides,
  };
}

describe("parseExecutedCount：日志正文里的执行条数", () => {
  it("vitest 零收集读成 0——正是 #3008 里被记成通过的那份日志", () => {
    const log = "RUN  v2.1.9\n\n Test Files  no tests\n      Tests  no tests\n   Duration  164ms\n";

    expect(parseExecutedCount(log)).toEqual({
      ok: true,
      executed: 0,
      matches: [{ runner: "vitest", line: "Tests  no tests", executed: 0 }],
    });
  });

  it("vitest 正常汇总只数 passed/failed，skipped 不算执行过", () => {
    const log = " Test Files  3 passed (3)\n      Tests  10 passed | 2 skipped (12)\n";
    const result = parseExecutedCount(log);

    expect(result).toMatchObject({ ok: true, executed: 10 });
  });

  it("`Test Files` 是文件数不是用例数，不参与计数", () => {
    const result = parseExecutedCount(" Test Files  3 passed (3)\n      Tests  no tests\n");

    expect(result).toMatchObject({ ok: true, executed: 0 });
  });

  it("playwright 的 passed/failed/flaky 相加，零收集读成 0", () => {
    expect(parseExecutedCount("  8 passed (3.4s)\n  1 failed\n  2 flaky\n")).toMatchObject({
      ok: true,
      executed: 11,
    });
    expect(parseExecutedCount("Error: No tests found\n")).toMatchObject({ ok: true, executed: 0 });
  });

  it("pytest 汇总行相加，`no tests ran` 读成 0", () => {
    expect(parseExecutedCount("==== 5 passed, 1 skipped in 0.42s ====\n")).toMatchObject({
      ok: true,
      executed: 5,
    });
    expect(parseExecutedCount("==== no tests ran in 0.01s ====\n")).toMatchObject({
      ok: true,
      executed: 0,
    });
  });

  it("多 lane 日志逐行汇总相加", () => {
    const log = [
      "      Tests  203 passed (203)",
      "  1 passed (12.0s)",
      "==== 4 passed in 1.20s ====",
    ].join("\n");

    expect(parseExecutedCount(log)).toMatchObject({ ok: true, executed: 208 });
  });

  it("带 ANSI 颜色的汇总行照样认得出", () => {
    const log = "      \u001B[1mTests\u001B[22m  \u001B[1m\u001B[32m6 passed\u001B[39m\u001B[22m (6)\n";

    expect(parseExecutedCount(log)).toMatchObject({ ok: true, executed: 6 });
  });

  it("认不出的日志格式报错，而不是记 0 放行", () => {
    expect(parseExecutedCount("build succeeded\nall good\n")).toEqual({
      ok: false,
      reason: "no vitest/playwright/pytest test-count summary line found in the log",
    });
  });
});

describe("parseEvidenceManifest：executed >= 1 与既有判据并列", () => {
  it("接受带真实执行条数的 manifest", () => {
    const parsed = parseEvidenceManifest(manifest(), { phase: "01", kind: "runtime" });

    expect(parsed).toMatchObject({ ok: true });
  });

  it("executed 为 0 被判非法——退出码 0 不再足以让零收集合法", () => {
    expect(parseEvidenceManifest(manifest({ executed: 0 }), { phase: "01", kind: "runtime" })).toEqual({
      ok: false,
      errors: ["executed must be an integer of at least 1 (zero collection is not a pass)"],
    });
  });

  it("缺 executed 字段的老形态 manifest 同样被判非法", () => {
    const { executed: _omitted, ...withoutExecuted } = manifest();

    expect(parseEvidenceManifest(withoutExecuted, { phase: "01", kind: "runtime" })).toEqual({
      ok: false,
      errors: ["executed must be an integer of at least 1 (zero collection is not a pass)"],
    });
  });

  it("executed 必须是整数，不接受小数或字符串", () => {
    for (const bad of [1.5, "12", null]) {
      expect(parseEvidenceManifest(manifest({ executed: bad }), { phase: "01", kind: "runtime" })).toEqual({
        ok: false,
        errors: ["executed must be an integer of at least 1 (zero collection is not a pass)"],
      });
    }
  });
});
