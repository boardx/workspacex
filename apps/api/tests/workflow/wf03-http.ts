/** WF03 HTTP 夹具：起真实 Nest 应用（kernel.module 合成），以某用户身份调接口。 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DATABASE_PORT, type DatabasePort } from "../../src/application/ports/database.port";
import { ensureDatabase, migrateOnce } from "../support/db";

export interface Wf03App {
  app: NestExpressApplication;
  base: string;
  db: DatabasePort;
}

export async function startWorkflowApp(env: Record<string, string> = {}): Promise<Wf03App> {
  ensureDatabase();
  await migrateOnce();
  process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
  process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const { createApp } = await import("../../src/main");
  const app = await createApp();
  await app.listen(0, "127.0.0.1");
  const addr = app.getHttpServer().address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return { app, base, db: app.get<DatabasePort>(DATABASE_PORT) };
}

export interface HttpResult<T = any> {
  status: number;
  body: T;
}

export function as(e: Wf03App, userId: string, orgId: string) {
  const headers = { "x-kernel-test-principal": `${userId}:${orgId}`, "content-type": "application/json" };
  const call = async <T = any>(method: string, path: string, body?: unknown): Promise<HttpResult<T>> => {
    const res = await fetch(`${e.base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await res.text();
    return { status: res.status, body: (text.length > 0 ? JSON.parse(text) : null) as T };
  };
  return {
    headers,
    get: <T = any>(path: string) => call<T>("GET", path),
    post: <T = any>(path: string, body: unknown) => call<T>("POST", path, body),
  };
}
