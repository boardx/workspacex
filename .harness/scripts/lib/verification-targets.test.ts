/**
 * verification-targets 的反证套件（#965）。
 *
 * 每一条断言都对应一种**真实发生过**的破坏方式，不是假想：
 *
 *   ① PR #961（exact head 1115421a）：F150–F152 的六条权威 verification 全部指向
 *      不存在的测试文件，`evidence` 全空，PR 照常合入并关掉三个 issue。
 *   ② 2026-09-21 实测的传导机制：vitest 的路径参数是**子串过滤器**不是文件名，
 *      `vitest run 存在.test.ts 不存在.test.ts` → `Test Files  1 passed (1)` **exit 0**
 *      （只给那个不存在的路径时才 exit 1）。verify.ts 只看退出码 ⇒ 看不出差别。
 *   ③ 本仓存量 F166：三条命令在 agent worktree 里 `[exit 0]` 跑绿并落成真实证据日志，
 *      那三个测试文件却 `git log --all` 零命中——从没进过任何 ref。
 *      「证据是真的、指向物是假的」这一档，doctor 既有的形态/指纹/入 main 三道检查
 *      一条都看不见。
 *
 * 所以本套件不只测「门会不会红」，也测 ⑥「门不能只会红」——本仓真实在用的正确形态
 * 必须原样放行，否则这道门会用假红逼人把对的命令改坏。
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  declaredTargets,
  describeMissingTargets,
  judgeVerificationTargetRatchet,
  missingVerificationTargets,
  staleVerificationTargetEntries,
  targetAllowlistKey,
  type PhaseVerificationTargets,
} from "./verification-targets";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** 真实存在的一条测试文件与一条必不存在的路径，用来构造两种指向物。 */
const REAL = "pnpm --filter @repo/contracts exec vitest run tests/contract-shape.test.ts";
const ABSENT_PATH = "tests/__verification_target_absent__.test.ts";
const ABSENT = `pnpm --filter @repo/contracts exec vitest run ${ABSENT_PATH}`;

describe("① 指向物解析：命令声称要跑的是哪些文件", () => {
  it("vitest 单路径 —— 路径按包目录还原成仓库根相对", () => {
    expect(declaredTargets(REAL, ROOT).map((t) => t.path)).toEqual([
      "packages/contracts/tests/contract-shape.test.ts",
    ]);
  });

  it("vitest 多路径 —— 每一个都是独立的指向物（#961 与 ② 的传导机制都在这一形态上）", () => {
    const cmd = `pnpm --filter api exec vitest run tests/a.test.ts tests/b.test.ts tests/c.test.ts`;
    expect(declaredTargets(cmd, ROOT).map((t) => t.path)).toEqual([
      "apps/api/tests/a.test.ts",
      "apps/api/tests/b.test.ts",
      "apps/api/tests/c.test.ts",
    ]);
  });

  it("pytest —— 路径相对 `cd` 的那个目录，不是仓库根", () => {
    const cmd = "cd apps/deep-agent-service && uv run pytest tests/test_harness.py -q";
    expect(declaredTargets(cmd, ROOT).map((t) => t.path)).toEqual([
      "apps/deep-agent-service/tests/test_harness.py",
    ]);
  });

  it("标志位不是指向物 —— `-q` / `--deselect` 拿去查文件必然假红", () => {
    const cmd =
      "cd apps/deep-agent-service && uv run pytest tests/golden -q " +
      "--deselect tests/golden/test_tc5_checkpoint_kill_recovery.py::test_tc5_sigkill_midrun_then_resume_and_time_travel";
    const paths = declaredTargets(cmd, ROOT).map((t) => t.path);
    expect(paths).not.toContain("apps/deep-agent-service/-q");
    expect(paths).not.toContain("apps/deep-agent-service/--deselect");
    // pytest node-id 的 `::test_xxx` 后半段是函数名不是路径，必须砍掉再查文件。
    expect(paths).toContain(
      "apps/deep-agent-service/tests/golden/test_tc5_checkpoint_kill_recovery.py",
    );
  });

  it("未登记形态不在本门控边界内 —— 返回空，交给 lint-verification-can-fail 判红，不重复报", () => {
    expect(declaredTargets("some totally unknown command", ROOT)).toEqual([]);
  });
});

describe("② 缺失判定：声称跑了而文件不在 = 那条命令验的是空气", () => {
  it("PR #961 的原形：verification 全部指向不存在的测试文件 ⇒ 全部点名", () => {
    // 逐字取自 issue #965 forensic 里 F150 的三条权威命令。
    const f961 = {
      id: "F150",
      status: "not_started",
      verification: [
        "pnpm --filter api exec vitest run tests/chat/attachment-upload-endpoint.test.ts",
        "pnpm --filter api exec vitest run tests/chat/attachment-upload-limits-reject.test.ts",
        "pnpm --filter @repo/contracts exec vitest run tests/chat/upload-attachment-contract.test.ts",
      ],
    };
    const missing = missingVerificationTargets(f961, { root: ROOT });
    expect(missing.map((m) => m.path)).toEqual([
      "apps/api/tests/chat/attachment-upload-endpoint.test.ts",
      "apps/api/tests/chat/attachment-upload-limits-reject.test.ts",
      "packages/contracts/tests/chat/upload-attachment-contract.test.ts",
    ]);
  });

  it("② 的传导机制：一真一假的多路径命令 —— 命令 exit 0，本门控仍然点名那个假的", () => {
    // 这一条是整道门存在的理由。2026-09-21 在本仓实测：
    //   $ pnpm --filter @repo/contracts exec vitest run tests/contract-shape.test.ts tests/__nope__.test.ts
    //   Test Files  1 passed (1)        → exit 0
    //   $ pnpm --filter @repo/contracts exec vitest run tests/__nope__.test.ts
    //   No test files found, exiting with code 1
    // 退出码这条信道看不出差别，所以判据必须独立于退出码。
    const mixed = {
      id: "FX",
      verification: [`pnpm --filter @repo/contracts exec vitest run tests/contract-shape.test.ts ${ABSENT_PATH}`],
    };
    const missing = missingVerificationTargets(mixed, { root: ROOT });
    expect(missing.map((m) => m.path)).toEqual([`packages/contracts/${ABSENT_PATH}`]);
  });

  it("指向物齐全时不得报红 —— 门不能只会红", () => {
    expect(missingVerificationTargets({ id: "FOK", verification: [REAL] }, { root: ROOT })).toEqual([]);
  });

  it("报错文本必须回显那条命令本身 —— 不回显，人看不出该改哪一条", () => {
    const missing = missingVerificationTargets({ id: "FX", verification: [ABSENT] }, { root: ROOT });
    const text = describeMissingTargets("FX", missing);
    expect(text).toContain("FX");
    expect(text).toContain(ABSENT);
    expect(text).toContain(`packages/contracts/${ABSENT_PATH}`);
  });

  it("同一指向物重复出现只报一次", () => {
    const missing = missingVerificationTargets({ id: "FX", verification: [ABSENT, ABSENT] }, { root: ROOT });
    expect(missing).toHaveLength(1);
  });
});

describe("③ 棘轮：只判 passing，存量豁免，名单只许变短", () => {
  const phase = (features: Array<Record<string, unknown>>): PhaseVerificationTargets[] => [
    { phaseId: "99", features: features as never },
  ];

  it("passing + 指向物缺失 + 不在名单 ⇒ 判红", () => {
    const { newGaps } = judgeVerificationTargetRatchet(
      phase([{ id: "F1", status: "passing", verification: [ABSENT] }]),
      [],
      { root: ROOT },
    );
    expect(newGaps.map((g) => g.key)).toEqual(["99/F1"]);
    expect(newGaps[0]!.missing.map((m) => m.path)).toEqual([`packages/contracts/${ABSENT_PATH}`]);
  });

  it("在名单里 ⇒ 豁免，不进 newGaps", () => {
    const { newGaps, grandfathered } = judgeVerificationTargetRatchet(
      phase([{ id: "F1", status: "passing", verification: [ABSENT] }]),
      [targetAllowlistKey("99", "F1")],
      { root: ROOT },
    );
    expect(newGaps).toEqual([]);
    expect(grandfathered).toEqual(["99/F1"]);
  });

  it("非 passing 指向将来才会建的测试文件 ⇒ 不判红（那是「还没实现」，不是「清单写错」）", () => {
    for (const status of ["not_started", "in_progress", "blocked"]) {
      const { newGaps } = judgeVerificationTargetRatchet(
        phase([{ id: "F1", status, verification: [ABSENT] }]),
        [],
        { root: ROOT },
      );
      expect(newGaps, `status=${status}`).toEqual([]);
    }
  });

  it("名单里的条目一旦不再需要豁免 ⇒ 判为陈旧，必须删掉", () => {
    // 指向物补齐了（改成真实存在的命令）
    expect(
      staleVerificationTargetEntries(
        phase([{ id: "F1", status: "passing", verification: [REAL] }]),
        ["99/F1"],
        { root: ROOT },
      ),
    ).toEqual(["99/F1"]);
    // 状态不再是 passing
    expect(
      staleVerificationTargetEntries(
        phase([{ id: "F1", status: "in_progress", verification: [ABSENT] }]),
        ["99/F1"],
        { root: ROOT },
      ),
    ).toEqual(["99/F1"]);
    // 仍然需要豁免的不算陈旧
    expect(
      staleVerificationTargetEntries(
        phase([{ id: "F1", status: "passing", verification: [ABSENT] }]),
        ["99/F1"],
        { root: ROOT },
      ),
    ).toEqual([]);
  });
});

describe("④ 名单是真实盘点的快照，不是空转", () => {
  const allowlistPath = join(ROOT, ".harness", "state", "verification-target-allowlist.json");

  it("名单文件存在，且每条都带逐条取证（_readme 里能查到那个 feature id）", async () => {
    expect(existsSync(allowlistPath)).toBe(true);
    const doc = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(allowlistPath, "utf8"))) as {
      _readme: string[];
      entries: string[];
    };
    expect(Array.isArray(doc.entries)).toBe(true);
    const readme = doc._readme.join("\n");
    for (const key of doc.entries) {
      // 条目形状 `<phaseId>/<featureId>`
      expect(key, `名单条目形状不对：${key}`).toMatch(/^[^/]+\/F\d+$/);
      expect(readme, `${key} 进了名单却没有逐条取证`).toContain(key);
    }
  });
});
