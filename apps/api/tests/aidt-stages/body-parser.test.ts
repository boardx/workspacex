import express, { json, type Request, type Response, type NextFunction } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { HttpException } from "@nestjs/common";
import { registerAidtStageBodyParser } from "../../src/interface/middleware/aidt-stages-body-parser";

async function withParser(run: (base: string) => Promise<void>) {
  const app = express();
  registerAidtStageBodyParser(app);
  app.use(json());
  app.put("/projects/:projectId/aidt/stages/:stageId", (_request, response) => response.json({ accepted: true }));
  app.post("/ordinary", (_request, response) => response.json({ accepted: true }));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    response.status(error instanceof HttpException ? error.getStatus() : 413).json({ rejected: true });
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}
it("allows the approved stage envelope without broadening ordinary endpoint limits", async () => {
  await withParser(async (base) => {
    const body = JSON.stringify({ text: "x".repeat(150 * 1024) });
    const stage = await fetch(`${base}/projects/group/aidt/stages/1`, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
    expect(stage.status).toBe(200); expect(await stage.json()).toEqual({ accepted: true });
    const ordinary = await fetch(`${base}/ordinary`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    expect(ordinary.status).toBe(413); await ordinary.arrayBuffer();
  });
});
it("rejects an oversized UTF-8 stage body even when its character count is below the limit", async () => {
  await withParser(async (base) => {
    const body = JSON.stringify({ text: "中".repeat(90000) });
    expect(body.length).toBeLessThan(256 * 1024);
    const result = await fetch(`${base}/projects/group/aidt/stages/1`, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
    expect(result.status).toBe(413); expect(await result.json()).toEqual({ rejected: true });
  });
});
