/**
 * F355 —— 全仓唯一的真实登录函数。
 *
 * 在这个文件之前，`login()` 只在 `lib/live-projects.ts` 里为 `/project/live`
 * 这一条页面存在，`(entry)/login` 走的是纯 mock 提交（`router.push("/projects")`，
 * 不发任何请求）。两条路径各自维护一份「登录」的含义，就是 AGENTS.md 点名的
 * 「同一事实两处声明」事故模式的登录版本。
 *
 * 现在两边都从这里 import：`(entry)/login`（正式登录页）与
 * `/project/live`（F122 的端到端验证页）共用同一个函数、同一份类型、
 * 同一个 `POST /auth/login`。类型从 `@repo/contracts` 推导，不重新声明。
 */
import { auth } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type LoginOut = z.infer<typeof auth.operations.login.out>;

export async function login(email: string, password: string): Promise<LoginOut> {
  return apiRequest<LoginOut>(auth.operations.login.path, {
    method: "POST",
    body: { email, password },
    sessionToken: null, // 登录本身不带 token
  });
}
