import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";
import { DEEP_AGENT_HITL_TOOL_NAME } from "@repo/contracts/deep-agent-hitl";

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
