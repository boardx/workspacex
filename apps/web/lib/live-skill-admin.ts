/**
 * #881 —— Skill 后台两条**后端早就接好、界面一直没接**的写路径的前端薄封装。
 *
 * | 能力 | 后端 | 本 issue 之前的界面 |
 * |---|---|---|
 * | 编辑 skill 版本内容 | `skill-version-edit.controller.ts`（#595） | ❌ `apps/web` 零调用 |
 * | 从 URL 导入 skill | `skill-url-import.controller.ts`（#595） | ❌ `apps/web` 零调用 |
 *
 * 起因是一个真实用户在后台 Skill 页上问「导入以后可以编辑吗」——答案当时是「后端可以，
 * 界面点不到」。这与 #617 / #619 / #660 是同一形状（#564 审计的「73% 契约无路由」）。
 *
 * ## 这个文件不做判断（与 `live-skill.ts` 逐字同一条纪律）
 *
 * 没有「是不是管理员」的分支，也不把 403 翻译成「按钮置灰」。权限是服务端的裁决
 * （两个用例各自的 `findOrgMembership` + admin 判定），这一层只把形状原样送过去、
 * 把失败原样带回来。在客户端复述一份权限规则 = 给同一条规则留第二份会漂移的副本。
 *
 * ## 形状与路径全部取自 `@repo/contracts`
 *
 * 手写路径或字段名的那一刻就多了一份副本；`tests/contract-single-source.test.ts`
 * 机械禁止第二份声明。
 */
import { wave2Runtime } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

type EditIn = z.infer<typeof wave2Runtime.operations.editSkillVersionContent.in>;
export type EditSkillVersionContentOut = z.infer<
  typeof wave2Runtime.operations.editSkillVersionContent.out
>;
export type ImportSkillFromUrlIn = z.infer<
  typeof wave2Runtime.operations.importSkillFromUrl.in
>;
export type ImportSkillFromUrlOut = z.infer<
  typeof wave2Runtime.operations.importSkillFromUrl.out
>;

/**
 * 编辑 = **追加一个新版本**，不是原地改旧版本。
 *
 * ⚠ 这不是本封装的选择，是服务端的不变量：`skill_versions` 对 app_rw 只 GRANT
 * SELECT/INSERT（见 `wave2_skill_starter_import.sql`），所以返回的 `versionId` 每次都是新的，
 * 旧版本原样留存。界面必须照这个事实呈现（"已保存为新版本 vN"），
 * 说成"已修改"会让用户以为历史被改写了。
 */
export async function editSkillVersionContent(
  skillId: string,
  content: EditIn["content"],
): Promise<EditSkillVersionContentOut> {
  // ⚠ 不吞失败：`ApiError` 直接抛给调用方。吞掉 403/422 再返回 null，会让「被拒绝」
  //   和「什么都没发生」在类型上无法区分，而界面正要把这两者显示成不同的东西。
  return apiRequest<EditSkillVersionContentOut>(
    wave2Runtime.operations.editSkillVersionContent.path.replace(
      ":skillId",
      encodeURIComponent(skillId),
    ),
    { method: "POST", body: { content } },
  );
}

/**
 * 从 URL 导入。`idempotencyKey` 由**调用方**给：同一个 key 重放会拿回同一次导入的结果
 * （服务端按 `(org_id, idempotency_key)` 存），这正是"点两次不会导入两份"的机制。
 * ⛔ 不要在这里用随机值悄悄生成它——那等于把幂等性关掉。
 */
export async function importSkillFromUrl(
  input: ImportSkillFromUrlIn,
): Promise<ImportSkillFromUrlOut> {
  return apiRequest<ImportSkillFromUrlOut>(
    wave2Runtime.operations.importSkillFromUrl.path,
    { method: "POST", body: input },
  );
}
