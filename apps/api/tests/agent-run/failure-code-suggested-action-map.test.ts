/**
 * F14（#2722）—— `FAILURE_CODE_SUGGESTED_ACTIONS`
 * （`packages/contracts/src/error-observability.ts`）遍历门控。
 *
 * `requirements/05-error-observability.md` R4 E2：「某个错误码没有映射到任何
 * suggestedAction，应被视为契约不完整，需要在开发阶段通过测试拦截（遍历所有已定义
 * 错误码确认均有映射），不允许上线后才发现某类错误无可行动建议」。
 * `contracts/error-observability/domain.md` I-2：每个 `FailureCode` 都有明确的
 * `SuggestedActionKind` 映射，可通过契约测试遍历验证无遗漏。
 *
 * 单一事实源纪律（`contracts/error-observability.ts` 头注）：
 * `HumanizedError.suggestedActions` 的生成不得绕开 `FAILURE_CODE_SUGGESTED_ACTIONS`
 * 另写一份——本文件只断言这一份映射本身完整，不重新声明第二份。
 */
import { describe, expect, it } from "vitest";
import { errorObservability as EO } from "@repo/contracts";

/** 遍历断言本身抽成函数，好在下面的 CP 反证里对着一份"退化"的映射复用同一条判据。 */
function assertEveryFailureCodeHasSuggestedActions(
  codes: readonly string[],
  map: Record<string, readonly string[]>,
): void {
  for (const code of codes) {
    const actions = map[code];
    if (!actions || actions.length === 0) {
      throw new Error(`FailureCode ${code} 缺少 suggestedAction 映射`);
    }
  }
}

describe("I-2 映射完整：遍历 FailureCode 全集，每一项都有非空 suggestedAction 映射", () => {
  it("FailureCode 至少定义了一个值（不是空枚举）", () => {
    expect(EO.FailureCode.options.length).toBeGreaterThan(0);
  });

  it("逐项遍历：每个 FailureCode 在 FAILURE_CODE_SUGGESTED_ACTIONS 里都有非空数组", () => {
    for (const code of EO.FailureCode.options) {
      const actions = EO.FAILURE_CODE_SUGGESTED_ACTIONS[code];
      expect(actions, `FailureCode ${code} 缺少 suggestedAction 映射`).toBeDefined();
      expect(actions.length, `FailureCode ${code} 的 suggestedAction 映射为空`).toBeGreaterThan(0);
    }
  });

  it("映射的 key 集合恰好等于 FailureCode 全集：不存在悬空 key，也不存在遗漏的 key", () => {
    const codes = [...EO.FailureCode.options].sort();
    const mappedKeys = Object.keys(EO.FAILURE_CODE_SUGGESTED_ACTIONS).sort();
    expect(mappedKeys).toEqual(codes);
  });

  it("每个映射值都只由已定义的 SuggestedActionKind 组成，不出现未声明的动作", () => {
    for (const code of EO.FailureCode.options) {
      for (const kind of EO.FAILURE_CODE_SUGGESTED_ACTIONS[code]) {
        expect(EO.SuggestedActionKind.options).toContain(kind);
      }
    }
  });

  it("R3 步骤 3：suggestedAction 整体至少覆盖 重试/简化任务重试/联系支持 三种", () => {
    const allKinds = new Set(Object.values(EO.FAILURE_CODE_SUGGESTED_ACTIONS).flat());
    expect(allKinds.has("retry")).toBe(true);
    expect(allKinds.has("simplify")).toBe(true);
    expect(allKinds.has("contact")).toBe(true);
  });

  it("CP 反证：清空其中一个 FailureCode 的映射，遍历断言必抛错——证明这条门控真的抓得住遗漏", () => {
    const codes = EO.FailureCode.options;
    const brokenCode = codes[0]!;
    const broken: Record<string, readonly string[]> = {
      ...EO.FAILURE_CODE_SUGGESTED_ACTIONS,
      [brokenCode]: [],
    };
    expect(() => assertEveryFailureCodeHasSuggestedActions(codes, broken)).toThrow(
      `FailureCode ${brokenCode} 缺少 suggestedAction 映射`,
    );
  });

  it("正例：真实的 FAILURE_CODE_SUGGESTED_ACTIONS 通过同一条断言函数，不抛错", () => {
    expect(() =>
      assertEveryFailureCodeHasSuggestedActions(EO.FailureCode.options, EO.FAILURE_CODE_SUGGESTED_ACTIONS),
    ).not.toThrow();
  });
});

describe("HumanizedError 契约形状：单一事实源没有第二份手写副本", () => {
  it("HumanizedError.suggestedActions 至少一项，且每项 kind 都来自 SuggestedActionKind", () => {
    const sample = EO.HumanizedError.safeParse({
      runId: "run_test",
      failureCode: "MODEL_CALL_FAILED",
      message: "这次模型没能返回可用内容，任务已停下。",
      suggestedActions: EO.FAILURE_CODE_SUGGESTED_ACTIONS.MODEL_CALL_FAILED.map((kind) => ({
        kind, label: kind, hint: kind,
      })),
      rawDetails: { errorCode: "MODEL_CALL_FAILED", stack: null },
    });
    expect(sample.success).toBe(true);
  });

  it("suggestedActions 为空数组时 zod 拒绝（.min(1) 门控没被绕开）", () => {
    const sample = EO.HumanizedError.safeParse({
      runId: "run_test",
      failureCode: "MODEL_CALL_FAILED",
      message: "x",
      suggestedActions: [],
      rawDetails: { errorCode: "MODEL_CALL_FAILED", stack: null },
    });
    expect(sample.success).toBe(false);
  });
});
