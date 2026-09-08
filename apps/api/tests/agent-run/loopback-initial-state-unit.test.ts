import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";
import { DEEP_AGENT_HITL_TOOL_NAME } from "@repo/contracts/deep-agent-hitl";
import { buildDeepAgentSkillCatalogBlock } from "../../src/application/agent-run/skill-catalog";

/** Exercise the actual fixture handler without creating a listener, process or Docker. */
function fixture() {
  let handle: (request: unknown, response: unknown) => void;
  const server = { listen: () => {}, close: () => {} };
  const source = readFileSync(new URL("../../scripts/loopback-deep-agent-provider.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: {}, process: {env: {LOOPBACK_DEEP_AGENT_PROVIDER_PORT: "9999", LOOPBACK_DEEP_AGENT_MULTISTEP_TRIGGER: "multistep"}, once: () => {}},
    require: (name: string) => {
      if (name === "node:http") return {createServer: (callback: typeof handle) => { handle = callback; return server; }};
      if (name === "node:crypto") return {randomUUID};
      if (name === "@repo/contracts/deep-agent-hitl") return {DEEP_AGENT_HITL_TOOL_NAME};
      // 路径矩阵 D4：替身判定「skill 目录块」时从产品源码取那一行头，不在替身里抄第二份
      // 字面量（同上面 `DEEP_AGENT_HITL_TOOL_NAME` 那条既有理由：允许分叉就等于允许静默
      // 假绿）。这个 shim 是白名单，新增依赖必须显式列进来——本条正是那个显式动作。
      if (name === "../src/application/agent-run/skill-catalog") return {buildDeepAgentSkillCatalogBlock};
      throw new Error(`unexpected fixture dependency: ${name}`);
    },
  });
  return (method: string, url: string, body?: unknown): Promise<any> => new Promise(resolve => {
    const request = Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), {method, url});
    const response = {writeHead: () => response, end: (text: string) => resolve(JSON.parse(text))};
    handle(request, response);
  });
}
it("new empty thread has no fabricated future tool history; ensureThread preserves real completed history", async () => {
  const request = fixture();
  await request("POST", "/threads", {thread_id: "thread"});
  expect(await request("GET", "/threads/thread/state")).toEqual({values: {messages: []}});
  await request("POST", "/threads/thread/runs", {input: {messages: [{role: "user", content: "actual user"}]}});
  const started = await request("GET", "/threads/thread/state");
  expect(started.values.messages.some((message: any) => message.tool_calls?.some((call: any) => call.name === "write_todos"))).toBe(true);
  await request("GET", "/threads/thread/runs/thread");
  expect(await request("GET", "/threads/thread/runs/thread")).toEqual({status: "success"});
  await request("POST", "/threads", {thread_id: "thread", if_exists: "do_nothing"});
  expect((await request("GET", "/threads/thread/state")).values.messages[0].content).toBe("actual user");
});
it("exact multistep trigger keeps run nonterminal across the early status polls", async () => {
  const request = fixture();
  await request("POST", "/threads", {thread_id: "thread"});
  await request("POST", "/threads/thread/runs", {input: {messages: [{role: "user", content: "multistep"}]}});
  for (let i = 0; i < 5; i += 1) expect(await request("GET", "/threads/thread/runs/thread")).toEqual({status: "pending"});
  expect(await request("GET", "/threads/thread/runs/thread")).toEqual({status: "success"});
});
