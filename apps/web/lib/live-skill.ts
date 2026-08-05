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

/* ═════════════════ #552：双重门禁的三条路径 ═════════════════ */

/**
 * ## 这三个函数补的是什么
 *
 * 在 #552 之前，这套系统里**没有任何路径能把一个 skill 变成「已启用」**：
 * `reviewSkillVersion` 有用例、有单测，interface 层引用数为 0。于是使用者
 * 自己新建的 skill 永远停在草稿，而 `mountSkillToThread` 硬要求 `已启用` ——
 * 「新建 skill」绿、「会话内挂载 skill」也绿，中间那条线是断的。
 *
 * ## ⚠ 这里**依然没有** `enableSkill`
 *
 * 契约的 `SKILLS_FORBIDDEN_ROUTES` 逐字禁止 `POST /skills/:skillId/enable`
 * （「一条直达的启用路由**就是那条绕过路径本身**」）。本文件因此没有那个函数，
 * 也没有任何一处直接写 `status: "已启用"`：那个状态只由 `reviewSkillVersion`
 * 的 approve 分支在服务端产生，前端只是把结果显示出来。
 *
 * ## ⚠ 同样不做判断
 *
 * 没有「我是不是方法论审核人」的分支，也没有「不是就把按钮藏起来」。
 * 两职能不合并（I-5/V14）是**服务端**的裁决：安全评审人调用审核会拿到
 * `REVIEWER_FUNCTION_MISMATCH`。在客户端复述一份，就是给同一条规则留了
 * 第二份会漂移的副本 —— 而这一条恰恰是 `SKILLS_FORBIDDEN_ROUTES` 要守的东西。
 */

export type RunSecurityScanOut = z.infer<typeof skills.operations.runSecurityScan.out>;
export type SubmitSkillForReviewOut = z.infer<typeof skills.operations.submitSkillForReview.out>;
export type ReviewSkillVersionOut = z.infer<typeof skills.operations.reviewSkillVersion.out>;
export type ReviewDecision = z.infer<typeof skills.ReviewDecision>;

/** 三条路径都是 `/skill-versions/:versionId/…`，占位符只有这一个。 */
function versionPath(path: string, versionId: string): string {
  return path.replace(":versionId", encodeURIComponent(versionId));
}

/** 门禁第一道（自动）。⚠ 判拒是 422 且**照样落库**——「扫过被拒」≠「从未扫过」。 */
export async function runSecurityScan(versionId: string): Promise<RunSecurityScanOut> {
  return apiRequest<RunSecurityScanOut>(
    versionPath(skills.operations.runSecurityScan.path, versionId),
    { method: "POST", body: { versionId } },
  );
}

/**
 * `草稿 → 待审核`。
 *
 * ⚠ `expectedVersion` 传的是调用方**上次看到的那个版本状态**（乐观并发）。
 *   不传会让两次提交里的一次被静默吞掉（契约 `SKILL_VERSION_CHANGED` 就是为它准备的）。
 */
export async function submitSkillForReview(
  versionId: string,
  expectedVersion: string,
): Promise<SubmitSkillForReviewOut> {
  return apiRequest<SubmitSkillForReviewOut>(
    versionPath(skills.operations.submitSkillForReview.path, versionId),
    { method: "POST", body: { versionId, expectedVersion } },
  );
}

/** 门禁第二道（人工）——**系统里唯一产生 `已启用` 的路径**。 */
export async function reviewSkillVersion(input: {
  readonly versionId: string;
  readonly decision: ReviewDecision;
  readonly reason: string;
  readonly riskAcks: readonly string[];
}): Promise<ReviewSkillVersionOut> {
  return apiRequest<ReviewSkillVersionOut>(
    versionPath(skills.operations.reviewSkillVersion.path, input.versionId),
    {
      method: "POST",
      body: {
        versionId: input.versionId,
        decision: input.decision,
        reason: input.reason,
        riskAcks: [...input.riskAcks],
      },
    },
  );
}
