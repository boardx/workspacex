/**
 * `POST /skill-versions/:versionId/trial-run`（契约 `skills.operations.runTrialRun`）的
 * 前端薄封装——`AgSkillEditor`（模型 A 的文件编辑器，见 `ag-screens.tsx`）「试跑」
 * 按钮唯一的真实调用方。
 *
 * ⚠ 后端实现（`apps/api/src/application/skill/trial-run-skill.ts`）面向的是**模型 A**
 *   （`skills`/`skill_versions`/`skill_version_files`），不是声明式契约模型 B——
 *   `versionId` 传的是模型 A 的 `skill_versions.id`。别处若要给模型 B 接一条独立的
 *   试跑，不要复用这个封装，理由见后端那份文件头注。
 */
import { skills } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type RunTrialRunOut = z.infer<typeof skills.operations.runTrialRun.out>;

function fillPath(template: string, params: Record<string, string>): string {
  let path = template;
  for (const [k, v] of Object.entries(params)) {
    path = path.replace(`:${k}`, encodeURIComponent(v));
  }
  return path;
}

export async function runSkillTrialRun(
  versionId: string,
  sampleInput: string,
): Promise<RunTrialRunOut> {
  return apiRequest<RunTrialRunOut>(
    fillPath(skills.operations.runTrialRun.path, { versionId }),
    { method: "POST", body: { versionId, sampleInput } },
  );
}
