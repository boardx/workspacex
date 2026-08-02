/**
 * 全仓唯一的真实登录函数——F122 之前只内嵌在 `/project/live` 页面里，issue #355
 * 把它提成共享模块，`(entry)/login`（正式登录页）与 `/project/live`（F122 验证页）
 * 两处调用同一份实现，不允许出现第二条登录路径。
 *
 * 类型与 `live-projects.ts` 同一条纪律：从 `@repo/contracts` 推导，不重新声明。
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
