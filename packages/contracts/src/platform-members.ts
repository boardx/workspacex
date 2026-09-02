/**
 * 契约束 `platform-members` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：前后端类型、运行时校验、OpenAPI 的共同来源，任何一样都不许手写第二份。
 *
 * ## 这是什么
 *
 * 后台成员管理的**平台级**：列出平台上全部账号及其各组织的成员身份，并给任一成员
 * 调整其在某个组织里的组织角色。与之并列的**组织级**在 `org-admin` 束
 * （`listOrgMembers` + `setOrgMemberRole`）——两级是同一件事的两个视角，
 * 不是两套角色体系：
 *
 *   · 组织级：组织 admin 看**本组织**的人，改**本组织**里的角色。
 *   · 平台级：平台超管看**所有组织**的人，改**任一组织**里的角色。
 *
 * ## 为什么读写都限定平台超管，不是「某个组织的 admin」
 *
 * 全平台的名册天然跨租户——它没有一个 `org_id` 可以拿来判定「你是不是这个组织的
 * admin」。按组织角色开放等于让任意一个组织的管理员看到别的组织有谁、是什么角色，
 * 这是一次跨租户的身份信息泄露。所以判定不是组织角色，是与 `system-error-logs`
 * 同一个、独立于组织之外的「平台超管」身份（`NOT_PLATFORM_SUPERUSER`，
 * `PlatformSuperuserGuard`，白名单来自部署环境变量 `PLATFORM_SUPERUSER_EMAILS`，
 * 不落库、不可由任何组织内的操作授予）。
 *
 * ## 「平台角色」本身为什么不在这里可改
 *
 * 平台超管是**部署配置**（`domain/system/platform-superuser.ts` 文件头写清了理由：
 * 落库的超管标记会继承全部组织级操作面）。本束只把它作为**只读事实**回显
 * （`platformSuperuser: boolean`），让运维在名册上看得见「谁是超管」；改白名单是
 * 运维改环境变量的动作，不是一个 HTTP 操作。
 *
 * ## 本地组织不在名册里
 *
 * `kind = "personal-local"` 的组织是「数据不出本机」的产品承诺（identity F16），
 * 「对任何他人不可见，包括平台运营」——`listPlatformMembers.out` 里**不出现**它们的
 * 成员行，`setPlatformMemberOrgRole` 对它们返回 `MEMBER_NOT_FOUND`（与「这个 orgId
 * 根本不存在」同形，不泄露本地组织的存在性）。`kind = "platform"`（`org-platform`）
 * 同样不列：它只有一个结构上无法登录的维护身份，不是人。
 */
import { z } from "zod";
import { OrgRole } from "./identity";

/* ─────────────────────────── 读模型 ─────────────────────────── */

/** 一个账号在一个组织里的成员身份（组织级 `listOrgMembers` 行的平台侧投影，多了组织名）。 */
export const PlatformMembershipRow = z
  .object({
    orgId: z.string(),
    orgName: z.string(),
    orgRole: OrgRole,
    teamId: z.string().nullable(),
    joinedAt: z.string(),
  })
  .strict();
export type PlatformMembershipRow = z.infer<typeof PlatformMembershipRow>;

/**
 * 一个平台账号 + 它的全部组织成员身份。
 *
 * ⚠ `memberships` 可以为空数组：注册了但还没进任何组织（或所在组织全是本地组织）的
 *   账号也是平台成员——名册的主语是「账号」，不是「成员行」。把这类人藏掉会让运维
 *   在「他明明注册了」和「名册上没有他」之间来回对不上。
 */
export const PlatformMemberRow = z
  .object({
    userId: z.string(),
    displayName: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    createdAt: z.string(),
    /** 只读回显：这个邮箱是否在 `PLATFORM_SUPERUSER_EMAILS` 白名单里。见文件头。 */
    platformSuperuser: z.boolean(),
    memberships: z.array(PlatformMembershipRow),
  })
  .strict();
export type PlatformMemberRow = z.infer<typeof PlatformMemberRow>;

/** ⚠ 每一个成员都在下方某个操作的 `err` 里出现——不会被抛出的错误码读起来像覆盖。 */
export const PlatformMembersError = z.enum([
  /** principal 已认证，但邮箱不在平台超管白名单里。与 `systemErrorLogs` 同码同义。 */
  "NOT_PLATFORM_SUPERUSER",
  /** 目标 `(orgId, userId)` 不是一条可管理的成员行（不存在 / 本地组织 / 平台组织，三者同形）。 */
  "MEMBER_NOT_FOUND",
  /** 与 `orgAdmin.LAST_ADMIN` 同码同义：这次改动会把该组织最后一名 admin 降掉。 */
  "LAST_ADMIN",
  "DEPENDENCY_UNAVAILABLE",
]);
export type PlatformMembersError = z.infer<typeof PlatformMembersError>;

/* ─────────────────────────── 操作 ─────────────────────────── */

export const operations = {
  /**
   * 平台超管专用：全平台账号名册，按注册时间正序。
   *
   * ⚠ 不分页：这是一份运维名册，不是一条持续增长的事件流（对比 `listSystemErrorLogs`
   *   的 `beforeId` 游标）。账号数到了需要分页的量级时，分页字段是一次契约变更，
   *   不是在这里预埋一个没人验证过的 `limit`。
   */
  listPlatformMembers: {
    method: "GET",
    path: "/platform/members",
    in: z.object({}).strict(),
    out: z.object({ members: z.array(PlatformMemberRow) }).strict(),
    err: ["NOT_PLATFORM_SUPERUSER", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 平台超管专用：改一名成员在某个组织里的组织角色。
   *
   * ⚠ 与组织级 `orgAdmin.setOrgMemberRole` **同一条写路径、同一条 `LAST_ADMIN` 判定**——
   *   平台级不是「更高权限所以可以绕过」：一个没有 admin 的组织对平台运维一样是麻烦。
   *   两者的差别只在授权面（平台超管 vs 该组织 admin）与路由，落库动作由同一个仓储方法承担。
   * ⚠ `previousOrgRole` 回传，理由同组织级：toast 与审计都要有前值；改成同一个角色是幂等重放。
   */
  setPlatformMemberOrgRole: {
    method: "PATCH",
    path: "/platform/members/:userId/organizations/:orgId/role",
    in: z.object({ userId: z.string(), orgId: z.string(), orgRole: OrgRole }).strict(),
    out: z
      .object({
        userId: z.string(),
        orgId: z.string(),
        orgRole: OrgRole,
        previousOrgRole: OrgRole,
      })
      .strict(),
    err: ["NOT_PLATFORM_SUPERUSER", "MEMBER_NOT_FOUND", "LAST_ADMIN", "DEPENDENCY_UNAVAILABLE"] as const,
  },
} as const;
