/**
 * 2026-09-06 人类反馈「agent 还在生成时也要能回复 A/B」——钉住主 composer 在 run 进行中
 * 的发送分流规则（`lib/chat-composer-running-reply.ts` 文件头）。
 */
import { describe, expect, it } from "vitest";
import {
  resolveRunningReplyRoute, runningReplyAckCopy, queuedReplyCopy, previewReplyText,
} from "@/lib/chat-composer-running-reply";

describe("resolveRunningReplyRoute —— run 进行中的回复走插话还是排队", () => {
  it("真实 runId 已解析且状态 running ⇒ interject（与 chat-host-interjection 渲染入口同一判据）", () => {
    expect(resolveRunningReplyRoute({ runId: "run-1", status: "running" })).toBe("interject");
  });

  it("runId 还没解析出来（时序缝隙）⇒ queue，不发注定被拒的插话", () => {
    expect(resolveRunningReplyRoute({ runId: null, status: "running" })).toBe("queue");
    expect(resolveRunningReplyRoute({ runId: "", status: "running" })).toBe("queue");
  });

  it("状态不是 running（等工具授权 / 暂停 / 还没收到 status_change）⇒ queue", () => {
    expect(resolveRunningReplyRoute({ runId: "run-1", status: "awaiting_tool_permission" })).toBe("queue");
    expect(resolveRunningReplyRoute({ runId: "run-1", status: "paused" })).toBe("queue");
    expect(resolveRunningReplyRoute({ runId: "run-1", status: null })).toBe("queue");
  });
});

describe("页脚文案", () => {
  it("短文本原样、长文本截断到 24 字加省略号", () => {
    expect(previewReplyText("B")).toBe("B");
    const long = "一".repeat(30);
    expect(previewReplyText(long)).toBe(`${"一".repeat(24)}…`);
  });

  it("插话 ack / 排队提示都带上用户原文", () => {
    expect(runningReplyAckCopy("B")).toContain("「B」");
    expect(queuedReplyCopy("B")).toBe("本地排队：「B」将在本轮结束后发送");
  });
});
