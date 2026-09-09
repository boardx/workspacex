import { operations, SkillFileSnapshot } from "@repo/contracts/skill-file-edit";
import type { z } from "zod";
import { apiRequest } from "./api-client";
export type SkillSnapshot = z.infer<typeof SkillFileSnapshot>;
export type SkillFileEdits = z.infer<typeof operations.saveSkillFiles.in>["mutations"];
export async function getSkillFileSnapshot(skillId: string, versionId: string): Promise<SkillSnapshot> {
  const op = operations.getSkillFileSnapshot;
  const result = op.out.parse(await apiRequest(op.path.replace(":skillId", encodeURIComponent(skillId)), { query: { versionId } }));
  if (result.skillId !== skillId || result.versionId !== versionId) throw new Error("文件快照与请求版本不匹配");
  return result;
}
export async function saveSkillFiles(skillId: string, expectedVersionId: string, mutations: SkillFileEdits): Promise<SkillSnapshot> {
  const op = operations.saveSkillFiles;
  const { skillId: _skillId, ...body } = op.in.parse({ skillId, expectedVersionId, mutations });
  const result = op.out.parse(await apiRequest(op.path.replace(":skillId", encodeURIComponent(skillId)), { method: op.method, body }));
  if (result.skillId !== skillId || result.versionId === expectedVersionId) throw new Error("保存结果未返回本 Skill 的新版本，请重新读取确认");
  return result;
}
