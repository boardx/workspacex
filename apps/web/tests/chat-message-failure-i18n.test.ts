import { expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { describeMessageFailure } from "@/lib/live-chat";

it("keeps raw action braces intact while redacting a known authorization failure", () => {
  const failure = new ApiError(403, "NO_WRITE_ROLE", "private upstream diagnostics");
  expect(describeMessageFailure(failure, "Action {status}", "en")).toBe("Action {status} failed: the current identity does not have write permission (HTTP 403).");
  expect(describeMessageFailure(failure, "原始操作")).toBe("原始操作失败：当前身份没有写入权限（HTTP 403）。");
});
it("preserves unknown Error.message verbatim instead of translating or reparsing its braces", () => {
  const failure = new Error("用户原文 {action} / English 🌍");
  expect(describeMessageFailure(failure, "Send", "en")).toBe("Send failed: 用户原文 {action} / English 🌍");
  expect(describeMessageFailure(failure, "发送")).toBe("发送失败：用户原文 {action} / English 🌍");
});
it("distinguishes a missing skill from a missing conversation in both locales", () => {
  const skill = new ApiError(404, "SKILL_NOT_FOUND", "raw");
  const thread = new ApiError(404, "THREAD_NOT_FOUND", "raw");
  expect(describeMessageFailure(skill, "Mount", "en")).toContain("this skill does not exist");
  expect(describeMessageFailure(thread, "Read", "en")).toContain("this conversation does not exist");
  expect(describeMessageFailure(skill, "挂载")).toContain("该 skill 不存在");
  expect(describeMessageFailure(thread, "读取")).toContain("对话不存在");
});
it("retains the idempotency/no-duplicate fact separately from a general state conflict", () => {
  const duplicate = new ApiError(409, "IDEMPOTENCY_CONFLICT", "raw");
  const conflict = new ApiError(409, "VERSION_CHANGED", "raw");
  expect(describeMessageFailure(duplicate, "Send", "en")).toContain("No duplicate message was created.");
  expect(describeMessageFailure(conflict, "Send", "en")).toContain("conversation state conflicts");
  expect(describeMessageFailure(duplicate, "发送")).toContain("未创建重复消息");
});
it("retains unknown canonical reason/status values without exposing raw server text", () => {
  const failure = new ApiError(418, "RAW_REASON", "private upstream diagnostics");
  expect(describeMessageFailure(failure, "Send", "en")).toBe("Send failed: RAW_REASON (HTTP 418).");
  expect(describeMessageFailure(failure, "发送")).toBe("发送失败：RAW_REASON（HTTP 418）。");
});
it("uses the owned fallback for values that are not errors", () => {
  expect(describeMessageFailure({ message: "not an Error" }, "Send", "en")).toBe("Send failed. Try again later.");
});
