import { afterAll, beforeAll, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { GuidedResearchBrief, operations } from "@repo/contracts/research";
import { GUIDED_RESEARCH_BODY_MAX_BYTES, registerGuidedResearchBodyParsers } from "../../src/interface/middleware/guided-research-body-parser";
let server: Server;
let base: string;
const paths = [
  ["POST", operations.createGuidedResearchSession.path],
  ["PUT", operations.confirmResearchBrief.path.replace(":sessionId", "test")],
  ["POST", operations.executeGuidedResearchNode.path.replace(":sessionId", "test").replace(":node", "brief")],
  ["POST", operations.executeGuidedResearchRuntime.path.replace(":sessionId", "test")],
  ["POST", operations.streamGuidedResearchRuntime.path.replace(":sessionId", "test")],
  ["POST", operations.runGuidedResearchSkillTurn.path],
] as const;
beforeAll(async () => {
  const app = express();
  registerGuidedResearchBodyParsers(app);
  app.use(express.json());
  app.all("*", (req, res) => {
    const parsed = GuidedResearchBrief.safeParse(req.body.brief);
    res.status(parsed.success ? 200 : 400).json(parsed.success ? parsed.data : {});
  });
  server = await new Promise<Server>(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
const brief = (length = 40000) => ({ topic: "研究", goal: "研".repeat(length), focus: "究".repeat(length), region: "中国", timeRange: "现在" });
const send = (method: string, path: string, body: string) => fetch(base + path, { method, headers: { "content-type": "application/json" }, body });
it.each(paths)("accepts full Chinese requirements over real HTTP on %s %s", async (method, path) => {
  const input = brief();
  const response = await send(method, path, JSON.stringify({ brief: input }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(input);
});
it("retains schema rejection above the character bound", async () => {
  expect((await send("POST", paths[0][1], JSON.stringify({ brief: brief(40001) }))).status).toBe(400);
});
it("keeps the default transport bound on unrelated routes", async () => {
  expect((await send("POST", "/unrelated", JSON.stringify({ brief: brief() }))).status).toBe(413);
});

it("accepts escaped Chinese JSON while retaining the same parsed brief", async () => {
  const input = brief();
  const escaped = JSON.stringify({ brief: input }).replace(/[\u0080-\uffff]/gu, char => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"));
  const response = await send("POST", paths[0][1], escaped);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(input);
});
it("rejects bodies beyond the bounded research allowance", async () => {
  expect((await send("POST", paths[0][1], JSON.stringify({ padding: "x".repeat(GUIDED_RESEARCH_BODY_MAX_BYTES) }))).status).toBe(413);
});
