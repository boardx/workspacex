import { AI_CATALOG_BODY_MAX_BYTES, registerAiCatalogBodyParsers } from "../../src/interface/middleware/ai-catalog-body-parser";
import { afterAll, beforeAll, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { Write, operations } from "@repo/contracts/ai-catalog-admin";
let server: Server;
let base: string;
const paths = [["POST", operations.create.path], ["PATCH", operations.update.path]].map(([method, path]) => [method, path!.replace(":orgId", "org-demo").replace(":kind", "skill").replace(":id", "example")]);
beforeAll(async () => {
  const app = express();
  registerAiCatalogBodyParsers(app);
  app.use(express.json());
  app.all("*", (req, res) => res.status(Write.safeParse(req.body).success ? 200 : 400).end());
  server = await new Promise<Server>(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
});
afterAll(async () => { server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
const payload = (content: string) => ({kind: "skill", input: {name: "Example", stableName: "example", description: "Description", content}});
const send = (method: string, path: string, body: string) => fetch(base + path, {method, headers: {"content-type": "application/json"}, body});
it.each(paths)("accepts a valid large Skill over HTTP %s %s", async (method, path) => {
  expect((await send(method!, path!, JSON.stringify(payload("x".repeat(110000))))).status).toBe(200);
});

it("accepts the maximum escaped Unicode Skill content", async () => {
  const body = JSON.stringify(payload("研".repeat(1000000))).replace(/[\u0080-\uffff]/gu, char => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"));
  expect((await send(paths[0]![0]!, paths[0]![1]!, body)).status).toBe(200);
});
it("retains contract character bounds, bounded transport, and unrelated route limits", async () => {
  expect((await send("POST", paths[0]![1]!, JSON.stringify(payload("x".repeat(1000001))))).status).toBe(400);
  expect((await send("POST", paths[0]![1]!, JSON.stringify({padding: "x".repeat(AI_CATALOG_BODY_MAX_BYTES)}))).status).toBe(413);
  expect((await send("POST", "/unrelated", JSON.stringify(payload("x".repeat(110000))))).status).toBe(413);
});
