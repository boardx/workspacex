/**
 * 蓝本审计写入端口（F28 / `uc-2-2` R6 / 契约 `templates.queryBlueprintAudit`）。
 *
 * ## 为什么是一个独立小端口，不是塞进 `ApplyBlueprintRepository`
 *
 * `ApplyBlueprintRepository.apply` 的方法集合是 F28 自己要断言「恒等于 `{apply}`」的
 * 白名单（见 `no-writeback-to-blueprint.test.ts` ③）——把审计写入也塞进那个接口，
 * 白名单就要么放行一个新方法名（削弱了那条断言本来要钉住的东西），要么把审计当成
 * 「写入六类的一部分」（审计失败不该回滚整个项目创建，两者不是同一个事务边界）。
 * 所以审计单独开一个端口，语义与 `application/provenance/ports.ts` 的 `ProvenanceWriter`
 * 一致：只有 `record`，没有 update/delete——审计记录本身不可回写。
 *
 * ## 为什么在 `ApplyBlueprintDeps` 里是可选的
 *
 * 本束（`templates`）今天还没有落地的 controller/infrastructure 层（同 F17/F18/F19 头注
 * 反复标注的同款缺口）：没有一处已经在生产路径上调用 `applyBlueprintUseCase`，所以也没有
 * 真实的审计持久化实现可接。把它做成可选依赖，是如实反映「审计写入的接口已经就位、
 * 调用点已经接好，但落库实现仍待 controller 落地时装配」这件事——而不是假装现在已经
 * 有一条端到端可见的审计链路。F28 自己的测试用内存假实现驱动这条链路，证明「调用点接对了」。
 */
import type { z } from "zod";
import { templates } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";

export type BlueprintAuditActionName = z.infer<typeof templates.BlueprintAuditAction>;

export interface BlueprintAuditRecordInput {
  readonly orgId: OrgId;
  readonly blueprintId: string;
  readonly actorId: string;
  readonly action: BlueprintAuditActionName;
  /** 附加信息（如被拒动作名、失败类别），供检索时展开——不是第二份事实源，只是 detail */
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface BlueprintAuditWriter {
  /** 只追加，没有 update/delete——同 `ProvenanceWriter` 的形状与理由 */
  record(input: BlueprintAuditRecordInput): Promise<void>;
}

export const BLUEPRINT_AUDIT_WRITER = Symbol("BlueprintAuditWriter");
