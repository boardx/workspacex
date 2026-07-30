/**
 * lint-verification-can-fail 的反证套件。
 *
 * 本仓已九次「全绿但空转」；这道门控本身就是为第十次（V-1）而写的。
 * 所以它比别的门控更没有资格只被「跑绿一次」就相信：每一条断言都对应一种
 * **真实发生过**的破坏方式，先确认门控会红，才有资格相信它绿时说明了什么。
 *
 * 覆盖：
 *   ① 黑名单逐条会红（含 V-1 的 `--filter web vitest run`、V-3 的根级 vitest、
 *      phase-03 的 `node -e`、`|| true` 吞退出码）
 *   ② 静态存在性：package.json 里没有那个 script ⇒ 恒 0 ⇒ 报红
 *   ③ 动态实证：**探针恒 0 时门控必须红**（注入一个假 runProbe 模拟未来某个
 *      pnpm/vitest 版本又变成「找不到文件也 exit 0」）
 *   ④ 未登记形态不得被静默放过
 *   ⑤ 空集不得平凡为真
 *   ⑥ 正确形态（phase-00 已证明的那一种）必须放行 —— 门控不能只会红
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error —— .mjs 无类型声明，故意直接引
import { lintVerificationCanFail, classify, UNTRUSTWORTHY_SHAPES } from "./lint-verification-can-fail.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 跑门控，喂合成清单；探针默认「必然失败变体确实非 0」（即真实世界的现状）。 */
function run(verification: string[], runProbe: (cmd: string) => number = () => 1) {
  return lintVerificationCanFail({
    root: ROOT,
    featureLists: [{ phase: "phase-synthetic", features: [{ id: "FX", verification }] }],
    runProbe,
  }) as { errors: string[]; probes: Array<{ shape: string; code?: number; skipped?: boolean }> };
}

const GOOD = "pnpm --filter api exec vitest run tests/kernel/rbac-two-layer.test.ts";

describe("① 已知不可信形态逐条会红", () => {
  const cases: Array<[string, string]> = [
    // V-1 本体：缺 exec。这一条是整道门控存在的理由。
    ["pnpm-filter-missing-exec", "pnpm --filter web vitest run tests/ui/whatever.test.ts"],
    ["root-scope-vitest", "pnpm vitest run tests/kernel/rbac-two-layer.test.ts"],
    ["node-dash-e-import", "node -e \"const s=require('./apps/web/lib/withdrawal-flow.ts');\""],
    ["swallowed-exit-code", "apps/api/scripts/verify-rls.sh || true"],
    ["echo", "echo ok"],
    ["literal-true", "true"],
    ["cat", "cat package.json"],
    ["ls", "ls apps/web"],
    ["test-exists", "test -f package.json"],
  ];

  for (const [name, cmd] of cases) {
    it(`${name} —— \`${cmd.slice(0, 46)}…\` 必须被点名`, () => {
      const { errors } = run([cmd]);
      expect(errors.join("\n")).toContain(name);
      // 点名不是泛泛报错：错误文本里必须出现那条命令本身，否则人看不出该改哪一条。
      expect(errors.join("\n")).toContain(cmd);
    });
  }

  it("清单每一条都带「怎么发现的」—— 缺了它，下一个人会以为这是凭空的规矩", () => {
    expect(UNTRUSTWORTHY_SHAPES.length).toBeGreaterThanOrEqual(9);
    for (const s of UNTRUSTWORTHY_SHAPES) {
      expect(s.discovered, `${s.name} 缺 discovered`).toBeTruthy();
      expect(s.why, `${s.name} 缺 why`).toBeTruthy();
      expect(["always-zero", "nondeterministic"]).toContain(s.kind);
    }
  });
});

describe("② 静态存在性", () => {
  it("package.json 里没有那个 script ⇒ pnpm 退 0 ⇒ 必须报红", () => {
    const { errors } = run(["pnpm --filter api run no-such-script-here"]);
    expect(errors.join("\n")).toContain("脚本不存在→恒 0");
  });

  it("真实存在的 script 放行（api 的 typecheck 是真的）", () => {
    const { errors } = run(["pnpm --filter api run typecheck"]);
    expect(errors).toEqual([]);
  });

  it("--filter 指向不存在的包 ⇒ 报红", () => {
    const { errors } = run(["pnpm --filter no-such-pkg exec vitest run tests/x.test.ts"]);
    expect(errors.join("\n")).toContain("包不存在");
  });

  it("脚本类命令的脚本文件不存在 ⇒ 报红", () => {
    const { errors } = run(["node apps/web/scripts/no-such-gate.mjs"]);
    expect(errors.join("\n")).toContain("指向物不存在");
  });

  it("测试文件还没写**不**报红 —— 那是「还没实现」，它本就该红在 vitest 里", () => {
    const { errors } = run(["pnpm --filter api exec vitest run tests/kernel/not-written-yet.test.ts"]);
    expect(errors).toEqual([]);
  });
});

describe("③ 动态实证：探针恒 0 时门控必须红", () => {
  it("模拟「未来某版 pnpm/vitest 找不到文件也 exit 0」—— 门控必须点名该形态", () => {
    const { errors } = run([GOOD], () => 0);
    expect(errors.join("\n")).toContain("恒 0:实证");
    expect(errors.join("\n")).toContain("vitest-file:api");
  });

  it("探针非 0 时放行，且报告里留下形态与退出码", () => {
    const { errors, probes } = run([GOOD], () => 3);
    expect(errors).toEqual([]);
    expect(probes.find((p) => p.shape === "vitest-file:api")?.code).toBe(3);
  });

  it("每种形态都被探到 —— 抽样只在形态内部抽，形态之间不抽", () => {
    const seen: string[] = [];
    run(
      [
        GOOD,
        "pnpm --filter web exec vitest run tests/ui/a.test.tsx",
        "grep -rq 'data-testid=.chat-thread-list' apps/web/components/chat",
        "apps/api/scripts/verify-rls.sh",
        "node apps/web/scripts/lint-withdrawal-flow.mjs",
      ],
      (cmd: string) => {
        seen.push(cmd);
        return 1;
      },
    );
    // 五条命令 = 五种形态 ⇒ 五次探针，一种都不能少
    expect(seen).toHaveLength(5);
    // 同形态多条命令只探一次（否则 800 条 verification 要跑 800 个子进程）
    const again: string[] = [];
    run([GOOD, GOOD.replace("rbac-two-layer", "rls-force-nonowner")], (c: string) => {
      again.push(c);
      return 1;
    });
    expect(again).toHaveLength(1);
  });
});

describe("④ 未登记形态不得被静默放过", () => {
  it("一个门控看不懂的命令 ⇒ 报「未登记形态」，不是放行", () => {
    const { errors } = run(["make verify-everything --fast"]);
    expect(errors.join("\n")).toContain("未登记形态");
  });

  it("classify 对已登记形态给出可执行的失败变体", () => {
    const c = classify(GOOD);
    expect(c.shape).toBe("vitest-file:api");
    expect(c.probe).toContain("--filter api exec vitest run");
    expect(c.probe).not.toBe(GOOD); // 变体必须真的和原命令不同，否则「实证」是自证
  });
});

describe("⑤ 空集不得平凡为真", () => {
  it("一个 feature_list 都没找到时报红，而不是 0/0 全绿", () => {
    const { errors } = lintVerificationCanFail({
      root: ROOT,
      featureLists: [],
      runProbe: () => 1,
    }) as { errors: string[] };
    expect(errors.join("\n")).toContain("无清单");
  });
});

describe("⑥ 门控不能只会红：phase-00 已证明的正确形态必须放行", () => {
  it("phase-00 真实用的六种命令全部放行", () => {
    const { errors } = run([
      "pnpm --filter api run typecheck",
      "pnpm --filter api run lint",
      "pnpm --filter api exec vitest run tests/kernel/rbac-two-layer.test.ts",
      "apps/api/scripts/verify-rls.sh",
      "pnpm --filter api run migrate:check",
      "node .harness/scripts/lint-contract-source.mjs",
      "pnpm --filter @repo/contracts run test",
      "pnpm --filter web run test",
    ]);
    expect(errors).toEqual([]);
  });
});
