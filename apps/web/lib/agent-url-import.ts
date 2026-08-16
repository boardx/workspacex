/**
 * #1415 —— `importAgentFromUrl`（`POST /admin/agents/url-imports`）的前端薄封装。
 *
 * 与 `live-skill-admin.ts` 的 `importSkillFromUrl` 逐字同一条纪律：不判断"是不是
 * 管理员"，不把 403 翻译成"按钮置灰"——权限是服务端的裁决（`import-agent-from-url.ts`
 * 的 `findOrgMembership` + admin 判定），这一层只把形状原样送过去、把失败原样带回来。
 * 形状与路径全部取自 `@repo/contracts`，不手写第二份（`tests/contract-single-source.test.ts`
 * 机械禁止）。
 */
import { wave2Runtime } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ImportAgentFromUrlIn = z.infer<typeof wave2Runtime.operations.importAgentFromUrl.in>;
export type ImportAgentFromUrlOut = z.infer<typeof wave2Runtime.operations.importAgentFromUrl.out>;

export async function importAgentFromUrl(input: ImportAgentFromUrlIn): Promise<ImportAgentFromUrlOut> {
  return apiRequest<ImportAgentFromUrlOut>(
    wave2Runtime.operations.importAgentFromUrl.path,
    { method: "POST", body: input },
  );
}
