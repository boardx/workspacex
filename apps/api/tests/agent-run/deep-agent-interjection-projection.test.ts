/**
 * Phase 14 后续 A（#2755）—— `DeepAgentModelProvider` 把 `ModelCallInput.interjection`
 * 投影到 LangGraph `config.configurable[KERNEL_INTERJECTION_CONFIGURABLE_KEY]` 的反证：
 *
 * · resume 分支（生产里插话实际到达内核的那条路，见 `interjection-handling.ts` 头注）：
 *   请求体在 `command.resume` 之外多出 `config.configurable.interjection`，形状逐字 = 输入；
 * · 新建 run 分支：`configurable` 里多出同名键，其余键（`org_skills`）逐字不变；
 * · 缺席 ⇒ 两条分支的请求体都**没有**这个键；resume 分支的 `config.configurable.org_skills`
 *   本身则**恒在**（issue #2768 修复：resume 不再是"不带 config"，见
 *   `deep-agent-resume-forwards-skills.test.ts` 那条修复的专属回归）——这里只钉插话键
 *   本身的出现/缺席，不复述 org_skills 恒在这件事。
 *
 * 只起一个进程内的 HTTP 假 deep-agent-service 抓请求体，不碰数据库。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KERNEL_INTERJECTION_CONFIGURABLE_KEY } from "@repo/contracts/artifacts-steering";
import { DeepAgentModelProvider } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import type { ModelCallInput } from "../../src/application/agent-run/ports";

const createRunBodies: Record<string, unknown>[] = [];
let server: Server;
let baseUrl = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    const json = (body: unknown): void => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && url === "/threads") return json({ thread_id: "t-1" });
    if (req.method === "POST" && /^\/threads\/[^/]+\/runs$/.test(url)) {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        createRunBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
        json({ run_id: "r-1" });
      });
      return;
    }
    if (req.method === "GET" && /^\/threads\/[^/]+\/runs\/[^/]+$/.test(url)) return json({ status: "success" });
    if (req.method === "GET" && /^\/threads\/[^/]+\/state$/.test(url)) {
      return json({ values: { messages: [{ type: "human", content: "hi" }, { type: "ai", content: "done" }] } });
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

function provider(): DeepAgentModelProvider {
  return new DeepAgentModelProvider({ baseUrl, timeoutMs: 5_000, pollIntervalMs: 1, streamEnabled: false });
}

const BASE: ModelCallInput = { modelProvider: "deep-agent", modelId: "deep-agent", system: "", user: "hi" };
const INTERJECTION = {
  interjectionId: "itj-1", text: "把第二页标题改成 X", classification: "adjustment" as const,
  receivedAt: "2026-09-05T00:00:00.000Z",
};

async function lastBodyAfter(input: ModelCallInput): Promise<Record<string, unknown>> {
  const before = createRunBodies.length;
  await provider().complete(input);
  expect(createRunBodies.length).toBe(before + 1);
  return createRunBodies[before]!;
}

describe("#2755 DeepAgentModelProvider：ModelCallInput.interjection → config.configurable.interjection", () => {
  it("resume 分支：带插话 ⇒ command.resume 之外多出 config.configurable.interjection（形状逐字 = 输入），org_skills 键仍在", async () => {
    const body = await lastBodyAfter({ ...BASE, resume: { decision: "approve" }, interjection: INTERJECTION });
    expect(body.command).toEqual({ resume: { decisions: [{ type: "approve" }] } });
    expect(body.config).toEqual({
      configurable: { org_skills: [], [KERNEL_INTERJECTION_CONFIGURABLE_KEY]: INTERJECTION },
    });
    expect(KERNEL_INTERJECTION_CONFIGURABLE_KEY).toBe("interjection");
  });

  it("resume 分支：不带插话 ⇒ 插话键不出现，但 config.configurable.org_skills 恒在（issue #2768）", async () => {
    const body = await lastBodyAfter({ ...BASE, resume: { decision: "reject" } });
    expect(Object.keys(body).sort()).toEqual(["assistant_id", "command", "config", "stream_mode"]);
    expect(body.config).toEqual({ configurable: { org_skills: [] } });
    expect(body.stream_mode).toContain("custom");
  });

  it("新建 run 分支：带插话 ⇒ configurable 多出同名键；不带 ⇒ 键不出现", async () => {
    const withIt = await lastBodyAfter({ ...BASE, interjection: INTERJECTION });
    const configurable = (withIt.config as { configurable: Record<string, unknown> }).configurable;
    expect(Object.keys(configurable).sort()).toEqual(["interjection", "org_skills"]);
    expect(configurable[KERNEL_INTERJECTION_CONFIGURABLE_KEY]).toEqual(INTERJECTION);

    const without = await lastBodyAfter({ ...BASE });
    expect(Object.keys((without.config as { configurable: Record<string, unknown> }).configurable)).toEqual(["org_skills"]);
  });
});
