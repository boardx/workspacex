/**
 * issue #3367 —— 「每个 `RUN_ERROR` 出口必须显式声明三类处置之一」这条门主要由**类型**守：
 * `writeRunError(code: AguiRunErrorCode)` 只收已在表里声明过的码（`copilotkit-agui.controller.ts`），
 * 而 `RUN_ERROR` 已被移出通用 `write()` 的入参联合，换个写法也绕不过去。
 *
 * 本文件守类型系统看不见的那两件事：
 *   ① `AgentRunError`（run 的终态码）**全部**在表里——它们由 `outcome.error` 动态透传，
 *      枚举加一个码而这里忘了跟，`asAguiRunErrorCode` 会把它悄悄折成 `UNKNOWN`；
 *      `TERMINAL_RUN_ERROR_DISPOSITION` 的 `Record<…>` 已经在编译期挡住这一点，这里再钉一次
 *      运行期的集合相等，防的是有人把那个 `Record` 改宽。
 *   ② 三类处置**各自都有真实成员**——第 3 类一个码都不剩时，这套机制就整个空转了
 *      （本仓「全绿但空转」已九次）。
 */
import { describe, expect, it } from "vitest";
import { AgentRunError } from "../src/wave2-runtime";
import { AGUI_RUN_ERROR_DISPOSITION, asAguiRunErrorCode, dispositionOf } from "../src/agui-run-error";

describe("AG-UI RUN_ERROR 的三类处置", () => {
  it("`AgentRunError` 的每一个码都已声明处置（否则会被悄悄折成 UNKNOWN）", () => {
    for (const code of AgentRunError.options) {
      expect(AGUI_RUN_ERROR_DISPOSITION[code], `${code} 没有声明处置`).toBeDefined();
      expect(asAguiRunErrorCode(code)).toBe(code);
    }
  });

  it("三类处置各自都有真实成员——没有哪一类是空转的", () => {
    const kinds = new Set(Object.values(AGUI_RUN_ERROR_DISPOSITION));
    expect(kinds).toEqual(new Set(["settled", "executor_owns_run", "approval_pending"]));
  });

  it("仍在等人批的两个码归第 3 类；执行器持有 run 的两个码归第 2 类", () => {
    expect(dispositionOf("AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION")).toBe("approval_pending");
    expect(dispositionOf("NO_PENDING_APPROVAL")).toBe("approval_pending");
    expect(dispositionOf("AGENT_RUN_TIMEOUT")).toBe("executor_owns_run");
    expect(dispositionOf("IDEMPOTENCY_CONFLICT")).toBe("executor_owns_run");
  });

  it("没登记过的码按最保守的一类处置，不当成待批", () => {
    expect(dispositionOf("COPILOTKIT_RUNTIME_RUN_FAILED")).toBe("settled");
    expect(dispositionOf(null)).toBe("settled");
    expect(asAguiRunErrorCode("NOT_A_REAL_CODE")).toBe("UNKNOWN");
  });
});
