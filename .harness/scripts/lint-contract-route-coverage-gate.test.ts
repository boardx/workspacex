/**
 * 「契约 → 路由」棘轮在**真仓库**上的反空洞检查 + 门控接线（issue #564）。
 *
 * fixture 单测（lib/contract-route-ratchet.test.ts）证明判据对不对，这一份证明两件别的事：
 *
 *   ① **今天的名单真的对应真实缺口**，不是一份谁都对不上的空壳。本仓栽过这个跟头：
 *      `lint-body-path-param-leak` 上线当天的正则漏了 `apiRequest<T>(` 形态，实际只扫了
 *      5.7% 的调用点，而「117 个文件、0 处泄漏」的结论看起来一样绿。
 *   ② **这道门装在 PR 门控上**。#2490 的教训：#539 那道门只挂在 `verify:harness:raw` 链里，
 *      而那条链只被 main 的 `e2e-full` 调用 —— PR 全绿 → 合入 → 红在一个本来就没人看的 job 里。
 *
 * ⚠ 这里**不**断言某条具体缺口存在。缺口是会被人补掉的，把「某条还红着」写进测试，
 *   等于让别人修好它的那个 PR 变红（同 contract-route-coverage-fs.test.ts 的理由）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { contractRouteCoverage } from "./lib/contract-route-coverage-fs";
import { judgeContractRouteRatchet, ratchetFailed } from "./lib/contract-route-ratchet";

const ROOT = join(__dirname, "..", "..");
const SCRIPT = join(ROOT, ".harness", "scripts", "lint-contract-route-coverage.mjs");
const ALLOWLIST = join(ROOT, ".harness", "state", "contract-route-coverage-allowlist.json");
const WORKFLOW = join(ROOT, ".github", "workflows", "harness-verify.yml");

function allowlist(): string[] {
  return JSON.parse(readFileSync(ALLOWLIST, "utf8")).operations;
}

describe("真仓库棘轮：名单与今天的缺口一致", () => {
  const report = contractRouteCoverage();
  const verdict = judgeContractRouteRatchet({ report, allowlist: allowlist() });

  it("今天是绿的：没有新缺口、没有陈旧条目、没有畸形条目", () => {
    expect(verdict.incomplete, verdict.incompleteReason ?? "").toBe(false);
    expect(verdict.newGaps.map((g) => `${g.bundle}:${g.operation}`)).toEqual([]);
    expect(verdict.staleEntries).toEqual([]);
    expect(verdict.malformedEntries).toEqual([]);
  });

  it("反空洞：名单绝大多数条目今天仍对应一条真实缺口（对不上的名单＝没有名单）", () => {
    expect(allowlist().length).toBeGreaterThan(0);
    expect(verdict.activeEntries).toBeGreaterThan(allowlist().length * 0.9);
  });

  it("反证：真仓库上注入一条不接线的新 operation → 当场红", () => {
    const injected = judgeContractRouteRatchet({
      report: {
        ...report,
        gaps: [
          ...report.gaps,
          {
            bundle: report.bundles.find((b) => b.inScope)!.bundle,
            phase: "01",
            operation: "probeBogusUnroutedOperation",
            method: "POST",
            path: "/probe-bogus/:id",
            contractFile: "packages/contracts/src/probe.ts",
          },
        ],
      },
      allowlist: allowlist(),
    });
    expect(ratchetFailed(injected)).toBe(true);
    expect(injected.newGaps.map((g) => g.operation)).toEqual(["probeBogusUnroutedOperation"]);
  });

  it("反证：往真名单里加一条今天并不缺的豁免 → 当场红（棘轮只能变短）", () => {
    const inScopeBundle = report.bundles.find((b) => b.inScope)!.bundle;
    const injected = judgeContractRouteRatchet({
      report,
      allowlist: [...allowlist(), `${inScopeBundle}:probeBogusOperation`],
    });
    expect(injected.staleEntries).toEqual([`${inScopeBundle}:probeBogusOperation`]);
  });
});

describe("命令行入口（正样本：门不是恒红）", () => {
  function run(args: string[]): { code: number; out: string } {
    // 退出 0 的样本也要看 stderr：降级 WARN 走的是 console.warn，不在 stdout 上。
    const r = spawnSync("pnpm", ["exec", "tsx", SCRIPT, ...args], { cwd: ROOT, encoding: "utf8" });
    return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }

  it("真仓库 → 退出 0，并说清楚名单有多长", () => {
    const r = run([]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("没有新增");
  });

  it("真仓库 + --strict → 同样退出 0（门控模式不是把正常状态判红）", () => {
    const r = run(["--strict"]);
    expect(r.code, r.out).toBe(0);
  });
});

interface Step { name?: string; run?: string }
interface Job { if?: string; steps?: Step[] }

function prJobs(): Record<string, Job> {
  const doc = parse(readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, Job> };
  return Object.fromEntries(
    Object.entries(doc.jobs).filter(([, job]) => {
      const cond = job.if ?? "";
      return (
        !/event_name\s*!=\s*'pull_request'/.test(cond) &&
        !/event_name\s*==\s*'(schedule|workflow_dispatch|push)'/.test(cond)
      );
    }),
  );
}

describe("门装在 PR 门控上（#2490 的教训：只挂在 main 的链里等于没装）", () => {
  it("至少一个在 pull_request 上跑的 job 有 step 执行 lint-contract-route-coverage", () => {
    const hits = Object.entries(prJobs()).flatMap(([name, job]) =>
      (job.steps ?? [])
        .filter((s) => /lint[:-]contract-route-coverage/.test(s.run ?? ""))
        .map((s) => `${name} › ${s.name ?? s.run}`),
    );
    expect(hits, "PR 门控里没有任何 step 跑 lint-contract-route-coverage").not.toEqual([]);
  });

  it("PR 门控上跑的是 --strict（扫不全不能当绿）", () => {
    const steps = Object.values(prJobs()).flatMap((job) => job.steps ?? []);
    const hit = steps.find((s) => /lint-contract-route-coverage/.test(s.run ?? ""));
    expect(hit?.run).toContain("--strict");
  });

  it("也在 verify:harness:raw 链里（本地一条命令跑完全部 harness 门）", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["verify:harness:raw"]).toContain("lint:contract-route-coverage");
    expect(pkg.scripts["lint:contract-route-coverage"]).toContain("lint-contract-route-coverage.mjs");
  });
});
