/**
 * #520 —— 声明式契约 skill 的前端薄封装（`/skill` 的「新建 skill」这条路径）。
 *
 * 后端边界是 #459 / PR #518 交付的 `SkillController`，本波次只有**三条**读写路径可用：
 * 创建草稿 / 列表 / 详情。第四条 `disableSkill` 存在但**必然拒绝**（无引用清单生产者，
 * 且状态机没有 `草稿 → 已停用` 这条边，见该 controller :276-287），所以这里**不封装它**——
 * 封装一个注定失败的入口，等于在界面上摆一个骗人的按钮。
 *
 * ## 这个文件不做判断
 *
 * 没有「是不是能力维护者」的分支，也没有把 403 翻译成「按钮置灰」的逻辑。
 * 权限是服务端的裁决（`application/skill/create-skill-draft.ts` + `PrincipalGuard`），
 * 这一层只负责把契约里的形状原样送过去、把失败原样带回来。
 * 在客户端复述一份权限规则，等于给同一条规则留了第二份会漂移的副本。
 *
 * ## 形状与路径全部来自 `@repo/contracts`
 *
 * 类型用 `z.infer` 取，路径用 `operations.*.path` 取——两者手写的那一刻就多了一份副本。
 * ⚠ `source` 刻意**不在**创建入参里：它由服务端按入口打标（`assignSourceByEntry`），
 *   调用方写它 ⇒ `SOURCE_TAG_IMMUTABLE`（契约 I-11）。
 */
import { skills } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type DeclarativeContract = z.infer<typeof skills.DeclarativeContract>;
export type SkillListItem = z.infer<typeof skills.SkillListItem>;
export type SkillDetail = z.infer<typeof skills.operations.getSkillDetail.out>;
export type CreateSkillDraftIn = z.infer<typeof skills.operations.createSkillDraft.in>;
export type CreateSkillDraftOut = z.infer<typeof skills.operations.createSkillDraft.out>;
type ListSkillsOut = z.infer<typeof skills.operations.listSkills.out>;

/**
 * ⚠ 后台管理台这条入口固定是 `library`。契约的 `entry` 是**四入口共用同一份可见性过滤**
 *   的选择器（I-14），不是随便一个标签——写错它会让这条路径用上别的入口的可见性规则。
 */
const LIBRARY_ENTRY = "library" as const;

export async function listSkills(orgId: string): Promise<readonly SkillListItem[]> {
  const out = await apiRequest<ListSkillsOut>(skills.operations.listSkills.path, {
    method: "GET",
    query: { orgId, entry: LIBRARY_ENTRY },
  });
  // ⚠ 空结果就是 `[]`，由调用方渲染**真实空态**；这里不塞任何示例 skill（契约 A1/V10）。
  return out.items;
}

export async function createSkillDraft(input: CreateSkillDraftIn): Promise<CreateSkillDraftOut> {
  // ⚠ 刻意**不**在这里兜住失败：`ApiError` 直接抛给调用方。吞掉 409/422 再返回 null 会让
  //   「被拒绝」和「什么都没发生」在类型上无法区分，而界面正是要把这两者显示成不同的东西。
  return apiRequest<CreateSkillDraftOut>(skills.operations.createSkillDraft.path, {
    method: "POST",
    body: input,
  });
}

export async function getSkillDetail(skillId: string): Promise<SkillDetail> {
  return apiRequest<SkillDetail>(
    skills.operations.getSkillDetail.path.replace(":skillId", encodeURIComponent(skillId)),
    { method: "GET" },
  );
}
