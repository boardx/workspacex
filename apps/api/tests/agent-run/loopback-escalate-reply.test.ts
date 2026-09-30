/**
 * uiux-r3 #4.2 / #4.4 —— 升级剧本的两句话：
 *  - 待决阶段 /stream 不流出「正在提交升级请求。」这类进行时旁白（它不会被结果替换，run 停下后
 *    会永远挂在线程里；升级卡片本身就是这一轮的状态）；
 *  - 裁决原文自带句号时，拼进模板不出现「。。」。
 */
import { expect, it } from "vitest";
import { fixture } from "./loopback-deep-agent-fixture";

function streamedText(frames: readonly string[]): string {
  let text = "";
  for (const frame of frames) {
    const line = frame.split("\n").find((l) => l.startsWith("data: "));
    if (line === undefined || !frame.includes("event: messages")) continue;
    const [chunk] = JSON.parse(line.slice("data: ".length)) as [{ content?: string; type?: string }];
    if (chunk?.type === "AIMessageChunk" && typeof chunk.content === "string") text += chunk.content;
  }
  return text;
}

async function escalateThenDecide(args: Record<string, unknown>) {
  const request = fixture({ LOOPBACK_DEEP_AGENT_STREAM_GAP_MS: "0" });
  await request("POST", "/threads", { thread_id: "t" });
  await request("POST", "/threads/t/runs", { input: { messages: [{ role: "user", content: "改一下合同条款 [escalate:超出我的职责]" }] } });
  const pending = request.openStream("/threads/t/runs/t/stream");
  await new Promise((resolve) => setTimeout(resolve, 50));
  await request("POST", "/threads/t/runs", { command: { resume: { decisions: [{ type: "edit", edited_action: { name: "escalate_matter", args } }] } } });
  const state = await request("GET", "/threads/t/state");
  const ai = (state.values.messages as { type: string; content: unknown }[]).filter((m) => m.type === "ai");
  return { pendingText: streamedText(pending.frames), finalText: String(ai[ai.length - 1]?.content ?? "") };
}

it("待决阶段不流出进行时旁白", async () => {
  const { pendingText } = await escalateThenDecide({ decision: "resolve", decisionText: "同意" });
  expect(pendingText).not.toContain("正在提交");
});

it("同意分支：终稿不复述裁决原文（线程里的「决定：…」记录已逐字展示）", async () => {
  const { finalText } = await escalateThenDecide({ decision: "resolve", decisionText: "同意，但你只整理需求。" });
  expect(finalText).toBe("负责人已同意。我会按这个裁决继续。");
  expect(finalText).not.toContain("只整理需求");
});

it("驳回分支：终稿不复述理由原文", async () => {
  const { finalText } = await escalateThenDecide({ decision: "reject", reason: "预算不够！" });
  expect(finalText).toBe("负责人不同意。这件事我不会执行，会据此调整方案。");
  expect(finalText).not.toContain("预算不够");
});
