/**
 * #523 判据本体的反证套件：**「这个 job 是不是每次 push/PR 都跑」判得对不对**。
 *
 * 这里全部是纯判定，不碰真实 `.github/`——真实仓库那一层在
 * `lint-spec-gate-coverage.test.ts` 里（它还要经过 playwright `--list`，慢得多）。
 *
 * ⚠ 每条断言都要能回答「它红的时候，是红在哪个判据上」。所以对照组一律**只改一处**：
 *   加不加 `paths:`、job 的 `if:` 换一句、需要的父 job 跑不跑。
 */
import { describe, expect, it } from "vitest";
import {
  PROBE_EVENTS,
  UNKNOWN,
  evaluateIf,
  triggerAdmits,
} from "./ci-job-conditions.mjs";

/** `.mjs` 没有 .d.ts，这里把用到的形状显式写一遍（与 `PROBE_EVENTS` 一一对应）。 */
type Probe = { id: string; eventName: string; ref: string; baseBranch: string; label: string };

const PROBES: Probe[] = PROBE_EVENTS;
const PR = PROBES.find((probe) => probe.id === "pull_request")!;
const PUSH_MAIN = PROBES.find((probe) => probe.id === "push-main")!;

describe("on: 触发器", () => {
  it("裸 pull_request ⇒ 每个 PR 都接纳（harness-verify / skill-files-e2e 的形状）", () => {
    expect(triggerAdmits({ pull_request: null }, PR).admits).toBe(true);
  });

  it("push 到 main、无路径过滤 ⇒ 接纳（backend-gates 的形状）", () => {
    expect(triggerAdmits({ push: { branches: ["main"], tags: ["v*"] } }, PUSH_MAIN).admits).toBe(true);
  });

  /**
   * #523 的病根本身。对照组与实验组**只差一个 `paths:`**——它红的时候，只可能
   * 红在「覆盖是有条件的」这一条上，不可能红在 job 改名、分支写法之类的旁枝上。
   */
  it("同一个 pull_request 触发器，只加一个 paths: ⇒ 从接纳翻成不接纳", () => {
    const without = { pull_request: {} };
    const with_ = { pull_request: { paths: ["apps/devportal/**"] } };
    expect(triggerAdmits(without, PR).admits).toBe(true);
    const verdict = triggerAdmits(with_, PR);
    expect(verdict.admits).toBe(false);
    expect(verdict.why).toContain("路径过滤"); // 红在对的原因上
  });

  it("paths-ignore 同样算条件触发 —— 它也是「只在某些改动下才来」", () => {
    expect(triggerAdmits({ push: { branches: ["main"], "paths-ignore": ["docs/**"] } }, PUSH_MAIN).admits).toBe(
      false,
    );
  });

  it("只有 workflow_dispatch / schedule ⇒ 两个探针事件都不接纳（取证类 workflow 的形状）", () => {
    for (const probe of PROBES) {
      expect(triggerAdmits({ workflow_dispatch: {} }, probe).admits).toBe(false);
      expect(triggerAdmits({ schedule: [{ cron: "0 * * * *" }] }, probe).admits).toBe(false);
    }
  });

  it("push 只钉在别的分支上 ⇒ 不接纳（deploy-cn-production 的 main-cn）", () => {
    expect(triggerAdmits({ push: { branches: ["main-cn"] } }, PUSH_MAIN).admits).toBe(false);
  });

  it("`on: push` 这种字符串/数组写法也要认", () => {
    expect(triggerAdmits("push", PUSH_MAIN).admits).toBe(true);
    expect(triggerAdmits(["push", "pull_request"], PR).admits).toBe(true);
  });
});

describe("job 的 if: 表达式", () => {
  it("没有 if ⇒ 跑", () => {
    expect(evaluateIf(undefined, PR)).toBe(true);
  });

  it("排除 schedule / workflow_dispatch 的写法在两个探针下都成立", () => {
    const expr = "github.event_name != 'schedule' && github.event_name != 'workflow_dispatch'";
    expect(evaluateIf(expr, PR)).toBe(true);
    expect(evaluateIf(expr, PUSH_MAIN)).toBe(true);
  });

  it("fork 守卫在同仓 PR 下成立 —— 否则 backend-gates 全套会被误判成条件覆盖", () => {
    const expr =
      "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository";
    expect(evaluateIf(expr, PR)).toBe(true);
  });

  it("e2e-full 那串：PR 上不跑，但每次合入 main 都跑 ⇒ 仍是无条件覆盖", () => {
    const expr =
      "github.event_name != 'pull_request' && (github.event_name != 'workflow_dispatch' || inputs.run_e2e_full)";
    expect(evaluateIf(expr, PR)).toBe(false);
    expect(evaluateIf(expr, PUSH_MAIN)).toBe(true);
  });

  it("只在手动勾选时跑的 job ⇒ 两个探针下都不跑（chat-task-workbench 的形状）", () => {
    const expr = "github.event_name == 'workflow_dispatch' && inputs.run_chat_task_workbench";
    expect(evaluateIf(expr, PR)).toBe(false);
    expect(evaluateIf(expr, PUSH_MAIN)).toBe(false);
  });

  it("always() / cancelled() 取顺利那一趟的值", () => {
    expect(evaluateIf("always() && !cancelled() && github.event_name == 'pull_request'", PR)).toBe(true);
  });

  it("needs.<job>.result 跟着父 job 的可达性走", () => {
    const expr = "needs.gates-fast.result == 'success'";
    expect(evaluateIf(expr, PR, { needsResults: new Map([["gates-fast", "success"]]) })).toBe(true);
    expect(evaluateIf(expr, PR, { needsResults: new Map([["gates-fast", "skipped"]]) })).toBe(false);
  });

  /**
   * 失败方向必须偏「吵」：认不出来的函数/上下文一律 UNKNOWN，而 UNKNOWN 在
   * `ciJobCommands` 里当作「不可达」⇒ 判成条件覆盖。猜成 true 才是本仓要挡的哑火。
   */
  it("认不出的函数 ⇒ UNKNOWN，不是 true", () => {
    expect(evaluateIf("startsWith(github.ref, 'refs/tags/v')", PUSH_MAIN)).toBe(UNKNOWN);
  });

  it("认不出的上下文 ⇒ UNKNOWN", () => {
    expect(evaluateIf("steps.dedup.outputs.run == 'true'", PR)).toBe(UNKNOWN);
  });

  it("语法坏掉的表达式 ⇒ UNKNOWN，不抛也不放行", () => {
    expect(evaluateIf("github.event_name == ", PR)).toBe(UNKNOWN);
  });

  it("UNKNOWN 不会污染已经能定下来的一边（短路语义）", () => {
    // 一个真值把 || 定死成 true：backend-gates 的 deploy 正是这个形状
    // （startsWith(...) 判不出来，但 github.ref == 'refs/heads/main' 判得出来）。
    expect(evaluateIf("startsWith(github.ref, 'refs/tags/v') || github.ref == 'refs/heads/main'", PUSH_MAIN)).toBe(
      true,
    );
    // 一个假值把 && 定死成 false。
    expect(evaluateIf("startsWith(github.ref, 'x') && github.event_name == 'schedule'", PUSH_MAIN)).toBe(false);
  });

  it("${{ }} 包裹的写法是同一条表达式", () => {
    expect(evaluateIf("${{ github.event_name == 'pull_request' }}", PR)).toBe(true);
  });
});
