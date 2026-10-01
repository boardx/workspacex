/**
 * Workflow 能力授权（组织管理员面）—— `workflow_capability_grants` 的查看 / 授予 / 撤销。
 *
 * ## 为什么需要
 *
 * WF04 的执行前权限重查（`effect-permission-recheck.ts`）按 (org, capabilityCategory) 读
 * `workflow_capability_grants`：没有配置行 ⇒ 默认只读（`read` 封顶，ADR-120 决策 #2）。
 * 内置 Workflow 的写阶段（如 W029 的 `persist` 需要 `artifact.write`、`notify` 需要
 * `notify.inapp`）因此一律停在 `blocked_permission`，而仓里没有任何入口能写这张表。
 * 本束补齐那个入口；**默认只读不变**——撤销 = 删除配置行 = 回到默认只读。
 *
 * ## 授权粒度
 *
 * 表按 (org, capabilityCategory) 存，不按 Workflow 存：给 `artifact.write` 授 `write` 就是给
 * 本组织所有用到它的 Workflow 授 `write`。清单按 Workflow 展开只是为了让管理员看清
 * 「这一项授权会影响哪些 Workflow 的哪些阶段」，不是第二套按 Workflow 的授权。
 *
 * 只允许授予内置 Workflow 目录里出现过的副作用能力分类（`UNKNOWN_CAPABILITY`），
 * 管理员不能凭空造一个分类名。
 *
 * 每次授予 / 撤销都写 `provenance_events`（`capability-updated` / `capability-disabled`，
 * target = `capability` / `workflow-capability:<分类>`），与写入同一事务。
 */
import { z } from "zod";
import { WorkflowSideEffectClass } from "./workflow-runtime";

/** 管理员可授予的上限（`none` 没有授予意义；撤销走 DELETE 回到默认 `read`）。 */
export const GrantableSideEffectCap = z.enum(["read", "write", "external_send"]);

/** 审计目标 id 的前缀——读写两侧同一处拼接，不各写一遍。 */
export const WORKFLOW_CAPABILITY_AUDIT_TARGET_PREFIX = "workflow-capability:";

export const WorkflowCapabilityGrantError = z.enum(["NOT_ORG_ADMIN", "UNKNOWN_CAPABILITY", "DEPENDENCY_UNAVAILABLE"]);

/** 一个能力分类在本组织的当前授权状态。 */
export const WorkflowCapabilityGrant = z
  .object({
    capabilityCategory: z.string().min(1),
    /** false = 没有配置行，按默认只读处理。 */
    configured: z.boolean(),
    authorized: z.boolean(),
    sideEffectCap: WorkflowSideEffectClass,
    updatedAt: z.string().nullable(),
    updatedBy: z.string().nullable(),
  })
  .strict();

/** 某个内置 Workflow 需要的一个副作用能力（聚合其所有阶段）。 */
export const WorkflowCapabilityNeed = z
  .object({
    capabilityCategory: z.string().min(1),
    /** 该 Workflow 用到此能力的阶段里最高的副作用等级。 */
    requiredCap: WorkflowSideEffectClass,
    stageIds: z.array(z.string()),
  })
  .strict();

export const WorkflowCapabilityCatalogEntry = z
  .object({
    workflowId: z.string(),
    workflowKey: z.string(),
    title: z.string(),
    capabilities: z.array(WorkflowCapabilityNeed),
  })
  .strict();

export const WorkflowCapabilityAuditEntry = z
  .object({
    eventId: z.string(),
    capabilityCategory: z.string(),
    action: z.enum(["granted", "revoked"]),
    fromCap: WorkflowSideEffectClass,
    toCap: WorkflowSideEffectClass,
    actorId: z.string(),
    at: z.string(),
  })
  .strict();

export const operations = {
  /** 仅组织 admin。内置 Workflow 目录 + 本组织授权现状 + 最近的变更记录。 */
  listWorkflowCapabilityGrants: {
    method: "GET",
    path: "/workflow-capability-grants",
    in: z.object({}).strict(),
    out: z
      .object({
        workflows: z.array(WorkflowCapabilityCatalogEntry),
        grants: z.array(WorkflowCapabilityGrant),
        audit: z.array(WorkflowCapabilityAuditEntry),
      })
      .strict(),
    err: ["NOT_ORG_ADMIN", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 仅组织 admin。授予（或调整）某能力分类的副作用上限。 */
  setWorkflowCapabilityGrant: {
    method: "PUT",
    path: "/workflow-capability-grants/:capabilityCategory",
    in: z.object({ sideEffectCap: GrantableSideEffectCap }).strict(),
    out: WorkflowCapabilityGrant,
    err: ["NOT_ORG_ADMIN", "UNKNOWN_CAPABILITY", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 仅组织 admin。撤销 = 删除配置行，回到默认只读。 */
  revokeWorkflowCapabilityGrant: {
    method: "DELETE",
    path: "/workflow-capability-grants/:capabilityCategory",
    in: z.object({}).strict(),
    out: WorkflowCapabilityGrant,
    err: ["NOT_ORG_ADMIN", "UNKNOWN_CAPABILITY", "DEPENDENCY_UNAVAILABLE"] as const,
  },
} as const;
