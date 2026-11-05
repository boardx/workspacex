import { expect, it } from "vitest";
import { deriveRunStatusView, type RunStatusViewInput } from "@repo/contracts/plan-control";
import { planSummaryText } from "@/components/chat/copilotkit-v2-plan-control";
import { planControlStatusMessageKey } from "@/lib/plan-control-owned-status";
import { translate } from "@/lib/i18n/messages";

it("retains the legacy default Chinese summary and raw caller content while handling English singular", () => {
  expect(planSummaryText("调用者原文 {total}", "done", false, 1, 1)).toBe("执行计划 · 调用者原文 {total} · 已完成");
  expect(planSummaryText("调用者原文", "executing", true, 1, 2)).toBe("执行计划 · 调用者原文 · 1/2 步已标记完成");
  expect(planSummaryText("调用者原文", "preparing", false, 0, 0)).toBe("执行计划 · 调用者原文");
  expect(planSummaryText("raw {total}", "executing", true, 1, 1, "en")).toBe("Execution plan · raw {total} · 1/1 step marked complete");
  expect(planSummaryText("raw", "executing", true, 1, 2, "en")).toBe("Execution plan · raw · 1/2 steps marked complete");
});

it("projects only contract-derived owned labels while preserving the authoritative view and raw unknown fallback", () => {
  const input: RunStatusViewInput = {
    phase: "failed", runStatus: "idle", stepStatuses: ["completed"],
    progressCompleted: 1, progressTotal: 1, paused: false, pauseRequested: false,
    gateRequired: false, hasRecentError: false, pauseEntryEnabled: false,
  };
  const failed = deriveRunStatusView(input);
  const original = { ...failed };
  const key = planControlStatusMessageKey(failed);
  expect(key).toBe("chatPlanControl.status.failedMarked");
  expect(translate("zh-CN", key!)).toBe(failed.stateLabel);
  expect(translate("en", key!)).toBe("Execution encountered a problem (steps were marked complete before interruption)");
  expect(failed).toEqual(original);
  expect(failed.progressValue).toBe(1);
  expect(failed.currentStepIndex).toBeNull();
  expect(failed.showRecovery).toBe(true);
  expect(planControlStatusMessageKey({ stateLabel: "未知caller原文 {state}" })).toBeUndefined();
});
