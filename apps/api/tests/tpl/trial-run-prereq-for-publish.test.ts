import { describe, expect, it } from "vitest";
import { templates } from "@repo/contracts";
import {
  countAppliedProjects,
  type BlueprintBinding,
} from "../../src/domain/templates/designer-shell";
import { evaluateTrialRunGate, hasTrialRun } from "../../src/domain/templates/trial-run-gate";
import {
  startTrialRun,
  verifyTrialRunSatisfiesGate,
} from "../../src/application/templates/start-trial-run";

/**
 * F21 —— **未试跑不得发布**（`uc-2-1` AC3a，契约 `TRIAL_RUN_REQUIRED`）。
 *
 * 与 `required-column-drives-gate.test.ts`（F17，必填面）刻意是**两份独立的测试文件**，
 * 对应两份独立的门——`publish-gate.ts` 头注逐字写着它自己不做试跑门槛。
 * F22 把两道门 `&&` 起来之前，两道门必须先能**各自**被证明会拦、会放行。
 *
 * ⚠ 试跑绑定必须**不计入**「用过 N 次」（I-22）——这条不是本文件的主角，
 * 但如果试跑门槛的实现顺手让试跑绑定被 `countAppliedProjects` 数进去，
 * 那是本束最容易复发的一类回归，所以本文件也钉一条防它。
 */

describe("没有试跑绑定 ⇒ 阻断（AC3a）", () => {
  it("空绑定集合 ⇒ blocked = true", () => {
    expect(evaluateTrialRunGate([]).blocked).toBe(true);
  });

  it("只有正式套用绑定、没有试跑绑定 ⇒ 仍然阻断 —— 套用不能顶替试跑", () => {
    const bindings: BlueprintBinding[] = [{ kind: "project" }, { kind: "project" }];
    expect(hasTrialRun(bindings)).toBe(false);
    expect(evaluateTrialRunGate(bindings).blocked).toBe(true);
  });
});

describe("有至少一条试跑绑定 ⇒ 放行", () => {
  it("恰好一条试跑绑定 ⇒ blocked = false", () => {
    const bindings: BlueprintBinding[] = [{ kind: "trial-run" }];
    expect(evaluateTrialRunGate(bindings).blocked).toBe(false);
  });

  it("试跑绑定与正式套用绑定混在一起 ⇒ 仍然放行，与顺序、与其余绑定数量无关", () => {
    const bindings: BlueprintBinding[] = [
      { kind: "project" },
      { kind: "trial-run" },
      { kind: "project" },
    ];
    expect(evaluateTrialRunGate(bindings).blocked).toBe(false);
  });
});

describe("startTrialRun 产出的绑定真的能让门槛从阻断变放行", () => {
  it("试跑前阻断，调用 startTrialRun 后用返回的绑定复核 ⇒ 放行", () => {
    const before: BlueprintBinding[] = [];
    expect(evaluateTrialRunGate(before).blocked).toBe(true);

    const result = startTrialRun("trial-1");
    expect(result.trialRunDone).toBe(true);
    expect(result.binding).toEqual({ kind: "trial-run" });

    expect(verifyTrialRunSatisfiesGate(before, result).blocked).toBe(false);
  });

  it("试跑绑定不计入用过 N 次（I-22）——门槛放行不代表『用过一次』", () => {
    const result = startTrialRun("trial-2");
    const bindings = [result.binding];
    expect(evaluateTrialRunGate(bindings).blocked).toBe(false);
    expect(countAppliedProjects(bindings)).toBe(0);
  });
});

describe("被拒时用的是契约里已有的那个码", () => {
  it("TRIAL_RUN_REQUIRED 是 publishBlueprintVersion 的失败面成员", () => {
    // 门在领域层判定（本文件），码在契约里；两边对不上时界面会拿到一个它不认识的失败。
    expect(templates.TemplateError.safeParse("TRIAL_RUN_REQUIRED").success).toBe(true);
    expect(templates.operations.publishBlueprintVersion.err).toContain("TRIAL_RUN_REQUIRED");
    // 反向：契约确实会拒绝一个不存在的码，否则上一条可能在空转
    expect(templates.TemplateError.safeParse("TRIAL_RUN_NOT_DONE").success).toBe(false);
  });

  it("startTrialRun 的失败面里没有 TRIAL_RUN_REQUIRED —— 试跑本身不会因为『还没试跑』被拒", () => {
    expect(templates.operations.startTrialRun.err).not.toContain("TRIAL_RUN_REQUIRED");
  });
});
