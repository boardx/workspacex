import { expect, it } from "vitest";
import { fixture } from "./loopback-deep-agent-fixture";

const env = { LOOPBACK_DEEP_AGENT_SCROLL_ACCEPTANCE_TRIGGER: "scroll", LOOPBACK_DEEP_AGENT_STREAM_GAP_MS: "1", LOOPBACK_DEEP_AGENT_SCROLL_STEP_MS: "0" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function start(request: ReturnType<typeof fixture>, text: string) {
  const { thread_id: id } = await request("POST", "/threads", {});
  await request("POST", `/threads/${id}/runs`, { input: { messages: [{ role: "user", content: text }] } });
  return id as string;
}

it("#3833 holds final text, authoritative final state and terminal status until the explicit same-turn release", async () => {
  const request = fixture(env);
  await request("POST", "/__test/f2/arm", { gateId: "a", userText: "scroll:F2:a" });
  const id = await start(request, "scroll:F2:a");
  const stream = request.openStream(`/threads/${id}/runs/${id}/stream`);
  try {
    let state = await request("GET", `/threads/${id}/state`);
    for (let n = 0; n < 100 && state.values.messages.filter((m: { type: string }) => m.type === "tool").length < 10; n++) {
      await sleep(10);
      state = await request("GET", `/threads/${id}/state`);
    }
    expect(state.values.messages.filter((m: { type: string }) => m.type === "tool")).toHaveLength(10);
    expect(JSON.stringify(state)).not.toContain("十步滚动验收执行完成");
    expect(stream.frames.join("")).not.toContain("AIMessageChunk");
    expect(stream.isEnded()).toBe(false);
    for (let n = 0; n < 30; n++) expect((await request("GET", `/threads/${id}/runs/${id}`)).status).toBe("pending");
    expect(await request("POST", "/__test/f2/release", { gateId: "wrong" })).toEqual({ error: "unknown gate" });
    expect(stream.isEnded()).toBe(false);
  } finally {
    await request("POST", "/__test/f2/release", { gateId: "a" });
  }
  for (let n = 0; n < 100 && !stream.isEnded(); n++) await sleep(10);
  expect(stream.isEnded()).toBe(true);
  expect(stream.frames.join("")).toContain("AIMessageChunk");
  expect(JSON.stringify(await request("GET", `/threads/${id}/state`))).toContain("十步滚动验收执行完成");
  expect((await request("GET", `/threads/${id}/runs/${id}`)).status).toBe("success");
});

it("ordinary unarmed scroll remains self-completing without any reconnect endpoint", async () => {
  const request = fixture(env);
  const id = await start(request, "scroll");
  const stream = request.openStream(`/threads/${id}/runs/${id}/stream`);
  for (let n = 0; n < 100 && !stream.isEnded(); n++) await sleep(10);
  expect(stream.isEnded()).toBe(true);
  expect((await request("GET", `/threads/${id}/runs/${id}`)).status).toBe("success");
});
