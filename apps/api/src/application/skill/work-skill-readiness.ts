/**
 * Phase 20 WS04 —— `getWorkSkillReadiness` 用例（契约 `work-skill-meta` UC-6；R3.8，A4/E5/E6，R5）。
 *
 * 读 = 本组织成员（非成员/跨组织/不存在 → NotFound）。授权读取失败不抛 5xx：降级为 overall=unknown（E5）。
 * grantHref 仅管理员可见，且只在非 satisfied 项上给出（R5）。结果不写缓存（R7 / I-11）。
 */
import type { IdentityRepository } from "../identity/ports";
import type { OrgId } from "../../domain/org-id";
import { isRegisteredCapabilityCategory } from "../../domain/skill/capability-category-registry";
import {
  computeSkillReadiness,
  type OrgToolCapabilityGrant,
  type ReadinessItem,
  type ToolGrantSnapshot,
} from "../../domain/skill/work-skill-readiness";
import { WorkSkillCatalogNotFoundError, type WorkSkillCatalogRepository } from "./work-skill-catalog";

export const TOOL_GRANT_READER = Symbol("ToolGrantReader");

/** 本组织工具 × 能力分类 × 授权快照（ADR-120 分类打标落地前由最小表承载）。 */
export interface ToolGrantReader {
  listForOrg(orgId: OrgId): Promise<readonly OrgToolCapabilityGrant[]>;
}

export interface WorkSkillReadinessDeps {
  readonly identities: IdentityRepository;
  readonly catalog: WorkSkillCatalogRepository;
  readonly grants: ToolGrantReader;
  readonly now?: () => Date;
}

export interface WorkSkillReadinessView {
  readonly skillId: string;
  readonly skillVersionId: string;
  readonly overall: "ready" | "not_ready" | "unknown";
  readonly missingRequired: number | null;
  readonly items: ReadonlyArray<ReadinessItem & { readonly grantHref: string | null }>;
  readonly computedAt: string;
}

export const toolGrantHref = (category: string): string => `/admin/tools?capabilityCategory=${encodeURIComponent(category)}`;

export async function getWorkSkillReadiness(
  deps: WorkSkillReadinessDeps,
  input: { readonly actorId: string; readonly orgId: OrgId; readonly skillId: string; readonly versionId?: string },
): Promise<WorkSkillReadinessView> {
  const membership = await deps.identities.findOrgMembership(input.actorId, input.orgId);
  if (!membership) throw new WorkSkillCatalogNotFoundError();
  const row = await deps.catalog.get(input.orgId, input.skillId, input.versionId);
  if (!row) throw new WorkSkillCatalogNotFoundError();

  let snapshot: ToolGrantSnapshot;
  try {
    snapshot = { ok: true, grants: await deps.grants.listForOrg(input.orgId) };
  } catch {
    snapshot = { ok: false };
  }
  const result = computeSkillReadiness(row.manifest.dependencies, snapshot, isRegisteredCapabilityCategory);
  const isAdmin = membership.orgRole === "admin";
  const versionId = input.versionId ?? row.currentVersionId;
  return {
    skillId: row.skillId,
    skillVersionId: versionId,
    overall: result.overall,
    missingRequired: result.missingRequired,
    items: result.items.map((item) => ({
      ...item,
      grantHref: isAdmin && item.state !== "satisfied" && item.reasonCode !== "CATEGORY_UNREGISTERED" ? toolGrantHref(item.category) : null,
    })),
    computedAt: (deps.now?.() ?? new Date()).toISOString(),
  };
}
