/**
 * `pickDefaultAgentId`（2026-08-14 devapp 实测反证）——composer 不该盲选
 * `agents[0]`：后端 `ORDER BY name` 下 Latin 字母排在中文之前，"Deep Research" 会
 * 意外排在"通用助手"前面被当成默认 agent（慢速多步的外部服务调用，意外选中会让
 * "发一句话"变成长时间卡在"思考中"）。纯函数，零 IO，同 `describeMessageFailure`
 * 的证明纪律。
 */
import { describe, expect, it } from "vitest";
import { lastUsedAgentId, pickDefaultAgentId } from "@/lib/live-chat";
import type { DurableMessage, GetAgentPanelOut } from "@/lib/live-chat";

type Agent = GetAgentPanelOut["agents"][number];

const agent = (id: string, name: string): Agent =>
  ({ id, abbr: name.slice(0, 2), name, duty: "test", roleLabel: "test", presence: "off" });

describe("pickDefaultAgentId", () => {
  it("requestedAgentId 命中候选集 → 原样用它（用户/调用方明确选过）", () => {
    const agents = [agent("a-1", "Deep Research"), agent("a-2", "通用助手")];
    expect(pickDefaultAgentId(agents, "a-1")).toBe("a-1");
  });

  it("requestedAgentId 未命中 + 候选集里有「通用助手」→ 优先选它，不管数组顺序", () => {
    // 复现 root cause：Deep Research（Latin）排在通用助手（中文）前面（ORDER BY name）。
    const agents = [agent("a-deep", "Deep Research"), agent("a-general", "通用助手")];
    expect(pickDefaultAgentId(agents, "")).toBe("a-general");
  });

  it("「通用助手」不在数组第一位也一样优先选中（不是巧合命中第一个）", () => {
    const agents = [
      agent("a-1", "Deep Research"), agent("a-2", "图片生成"), agent("a-3", "通用助手"),
    ];
    expect(pickDefaultAgentId(agents, "")).toBe("a-3");
  });

  it("候选集里没有「通用助手」→ 退回原来的「数组第一个」兜底，不引入新空态", () => {
    const agents = [agent("a-deep", "Deep Research"), agent("a-img", "图片生成")];
    expect(pickDefaultAgentId(agents, "")).toBe("a-deep");
  });

  it("候选集为空数组 → 空串（既有行为，未改变）", () => {
    expect(pickDefaultAgentId([], "")).toBe("");
  });

  it("候选集为 null/undefined → 空串（既有行为，未改变）", () => {
    expect(pickDefaultAgentId(null, "")).toBe("");
    expect(pickDefaultAgentId(undefined, "")).toBe("");
  });

  it("requestedAgentId 指向一个已不在候选集里的 id（agent 被下线/换编制）→ 同「未命中」路径", () => {
    const agents = [agent("a-general", "通用助手")];
    expect(pickDefaultAgentId(agents, "a-stale-id")).toBe("a-general");
  });
});

/**
 * `lastUsedAgentId`（#1806 反证）——2026-08-22 devapp 实测：重开线程后选择器不恢复成
 * 线程实际用过的 agent，而是硬编码回落「通用助手」。这里钉住「从已加载消息里挑最近一条
 * agent 消息的 agentId」这个纯函数本身，组件接线的回归见
 * `tests/ui/chat-live-message-panel-agent-selector-restore.test.tsx`。
 */
function agentMsg(over: Partial<DurableMessage> & { id: string }): DurableMessage {
  return {
    authorKind: "agent", authorId: "sys", agentId: null, text: "", clientMessageId: null,
    agentRunId: null, replyToMessageId: null, createdAt: "2026-01-01T00:00:00.000Z", ...over,
  };
}

describe("lastUsedAgentId", () => {
  it("多条 agent 消息 → 取 createdAt 最新的那条的 agentId，不管数组顺序", () => {
    const messages = [
      agentMsg({ id: "m-1", agentId: "agent-general", createdAt: "2026-08-20T00:00:00.000Z" }),
      agentMsg({ id: "m-2", agentId: "agent-deep-research", createdAt: "2026-08-22T00:00:00.000Z" }),
      agentMsg({ id: "m-3", agentId: "agent-general", createdAt: "2026-08-21T00:00:00.000Z" }),
    ];
    expect(lastUsedAgentId(messages)).toBe("agent-deep-research");
  });

  it("human 消息（authorKind !== 'agent'）不参与计算，即便本身带了字段", () => {
    const messages = [
      { ...agentMsg({ id: "m-1", agentId: "agent-general" }), authorKind: "human" as const },
    ];
    expect(lastUsedAgentId(messages)).toBe("");
  });

  it("agent 消息但 agentId 为 null（历史行/legacy）→ 跳过，不当成候选", () => {
    const messages = [agentMsg({ id: "m-1", agentId: null })];
    expect(lastUsedAgentId(messages)).toBe("");
  });

  it("空消息列表（线程还没消息，或当前窗口还没加载到）→ 空串", () => {
    expect(lastUsedAgentId([])).toBe("");
  });

  it("单条 agent 消息 → 直接取它", () => {
    const messages = [agentMsg({ id: "m-1", agentId: "agent-image-gen" })];
    expect(lastUsedAgentId(messages)).toBe("agent-image-gen");
  });
});
