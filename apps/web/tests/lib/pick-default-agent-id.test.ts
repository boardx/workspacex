/**
 * `pickDefaultAgentId`（2026-08-14 devapp 实测反证）——composer 不该盲选
 * `agents[0]`：后端 `ORDER BY name` 下 Latin 字母排在中文之前，"Deep Research" 会
 * 意外排在"通用助手"前面被当成默认 agent（慢速多步的外部服务调用，意外选中会让
 * "发一句话"变成长时间卡在"思考中"）。纯函数，零 IO，同 `describeMessageFailure`
 * 的证明纪律。
 */
import { describe, expect, it } from "vitest";
import { pickDefaultAgentId } from "@/lib/live-chat";
import type { GetAgentPanelOut } from "@/lib/live-chat";

type Agent = GetAgentPanelOut["agents"][number];

const agent = (id: string, name: string): Agent =>
  ({ id, abbr: name.slice(0, 2), name, duty: "test", presence: "off" });

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
