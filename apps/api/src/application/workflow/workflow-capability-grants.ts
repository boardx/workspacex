/**
 * Workflow 能力授权管理面（组织管理员授予 / 撤销 `workflow_capability_grants`）。
 *
 * 读端（执行前重查）仍是 `EffectCapabilityAuthorityPort`；这里是**写端**与它的管理清单。
 * 三件事都不可省（与 `mutate-capability.ts` 同一纪律）：
 *   1. 判组织 admin —— 非 admin 先写一条 `unauthorized-attempt` 再拒绝（被拒的探测也要留痕）；
 *   2. 写配置行；
 *   3. 同一事务里写 `provenance_events`（前后值）—— 审计没落地，授权也不生效。
 *
 * 默认只读不变（ADR-120 决策 #2）：撤销 = 删除配置行，回到 `read` 封顶。
 * 只允许内置 Workflow 目录里出现过的副作用能力分类（`UNKNOWN_CAPABILITY`）。
 */
import { workflowCapabilityGrants as C } from "@repo/contracts";
import type { z } from "zod";
import { PRODUCT_LINE_WORKFLOWS, type ContentWorkflowDefinition } from "../../domain/work-content/product-workflow-definitions";
import { PLANNED_WORKFLOW_SIDE_EFFECT_CATEGORIES } from "../../domain/skill/capability-category-registry";
import { toOrgId } from "../../domain/org-id";
import type { TenantSession } from "../ports/database.port";
import type { IdentityRepository } from "../identity/ports";
import type { ProvenanceReader, ProvenanceWriter } from "../provenance/ports";
import { withinSideEffectCap, type WorkflowSideEffectClass } from "./effect-gateway";

export type WorkflowCapabilityGrant = z.infer<typeof C.WorkflowCapabilityGrant>;
export type WorkflowCapabilityCatalogEntry = z.infer<typeof C.WorkflowCapabilityCatalogEntry>;
export type WorkflowCapabilityAuditEntry = z.infer<typeof C.WorkflowCapabilityAuditEntry>;
export type GrantableSideEffectCap = z.infer<typeof C.GrantableSideEffectCap>;

export const WORKFLOW_CAPABILITY_GRANT_STORE = Symbol("WorkflowCapabilityGrantStore");

export interface StoredCapabilityGrant {
  capabilityCategory: string;
  authorized: boolean;
  sideEffectCap: WorkflowSideEffectClass;
  updatedAt: string;
  updatedBy: string | null;
}

/** `audit` 在写入的同一事务里执行；它抛错则整笔回滚。 */
export type AuditWithin = (session: TenantSession, before: StoredCapabilityGrant | null) => Promise<unknown>;

export interface WorkflowCapabilityGrantStore {
  list(orgId: string): Promise<StoredCapabilityGrant[]>;
  upsert(orgId: string, capabilityCategory: string, sideEffectCap: WorkflowSideEffectClass, actorId: string, audit: AuditWithin): Promise<StoredCapabilityGrant>;
  /** 返回删除前的行（没有配置行时为 null，仍执行 audit）。 */
  remove(orgId: string, capabilityCategory: string, audit: AuditWithin): Promise<StoredCapabilityGrant | null>;
}

export class WorkflowCapabilityGrantError extends Error {
  constructor(readonly reasonCode: "NOT_ORG_ADMIN" | "UNKNOWN_CAPABILITY") {
    super(reasonCode);
  }
}

const DEFAULT_CAP: WorkflowSideEffectClass = "read";
const SIDE_EFFECT_STAGES = new Set<WorkflowSideEffectClass>(["write", "external_send"]);

/** 纯函数：内置 Workflow 目录中每个 Workflow 需要的副作用能力（只列 write / external_send 阶段）。 */
export function buildCapabilityCatalog(defs: readonly ContentWorkflowDefinition[] = PRODUCT_LINE_WORKFLOWS): WorkflowCapabilityCatalogEntry[] {
  return defs.map((def) => {
    const byCat = new Map<string, { requiredCap: WorkflowSideEffectClass; stageIds: string[] }>();
    for (const stage of def.stages) {
      if (!SIDE_EFFECT_STAGES.has(stage.sideEffect)) continue;
      for (const cat of stage.capabilityCategories) {
        const cur = byCat.get(cat);
        if (!cur) byCat.set(cat, { requiredCap: stage.sideEffect, stageIds: [stage.stageId] });
        else {
          if (!withinSideEffectCap(stage.sideEffect, cur.requiredCap)) cur.requiredCap = stage.sideEffect;
          cur.stageIds.push(stage.stageId);
        }
      }
    }
    return {
      workflowId: def.workflowId,
      workflowKey: def.key,
      title: def.title,
      capabilities: [...byCat.entries()].map(([capabilityCategory, v]) => ({ capabilityCategory, ...v })),
    };
  });
}

export function grantableCategories(catalog: readonly WorkflowCapabilityCatalogEntry[] = buildCapabilityCatalog()): Set<string> {
  return new Set([
    ...catalog.flatMap((w) => w.capabilities.map((c) => c.capabilityCategory)),
    ...PLANNED_WORKFLOW_SIDE_EFFECT_CATEGORIES,
  ]);
}

function toView(capabilityCategory: string, row: StoredCapabilityGrant | null): WorkflowCapabilityGrant {
  return row
    ? { capabilityCategory, configured: true, authorized: row.authorized, sideEffectCap: row.sideEffectCap, updatedAt: row.updatedAt, updatedBy: row.updatedBy }
    : { capabilityCategory, configured: false, authorized: true, sideEffectCap: DEFAULT_CAP, updatedAt: null, updatedBy: null };
}

const effectiveCap = (row: StoredCapabilityGrant | null): WorkflowSideEffectClass =>
  row === null ? DEFAULT_CAP : row.authorized ? row.sideEffectCap : "none";

export interface WorkflowCapabilityGrantDeps {
  identity: IdentityRepository;
  store: WorkflowCapabilityGrantStore;
  provenanceWriter: ProvenanceWriter;
  provenanceReader: ProvenanceReader;
}

export class WorkflowCapabilityGrantService {
  private readonly catalog = buildCapabilityCatalog();
  private readonly allowed = grantableCategories(this.catalog);

  constructor(private readonly deps: WorkflowCapabilityGrantDeps) {}

  async list(orgId: string, actorId: string) {
    await this.requireAdmin(orgId, actorId, "listWorkflowCapabilityGrants");
    const rows = await this.deps.store.list(orgId);
    const byCat = new Map(rows.map((r) => [r.capabilityCategory, r]));
    const grants = [...this.allowed].sort().map((cat) => toView(cat, byCat.get(cat) ?? null));
    const page = await this.deps.provenanceReader.query(toOrgId(orgId), {
      types: ["capability-updated", "capability-disabled"],
      targetKind: "capability",
      limit: 200,
    });
    const audit: WorkflowCapabilityAuditEntry[] = page.events.flatMap((e) => {
      if (!e.target.id.startsWith(C.WORKFLOW_CAPABILITY_AUDIT_TARGET_PREFIX)) return [];
      const d = e.detail as { capabilityCategory?: unknown; from?: unknown; to?: unknown };
      const from = C.WorkflowCapabilityGrant.shape.sideEffectCap.safeParse(d.from);
      const to = C.WorkflowCapabilityGrant.shape.sideEffectCap.safeParse(d.to);
      if (typeof d.capabilityCategory !== "string" || !from.success || !to.success) return [];
      return [{
        eventId: e.id,
        capabilityCategory: d.capabilityCategory,
        action: e.type === "capability-disabled" ? "revoked" as const : "granted" as const,
        fromCap: from.data,
        toCap: to.data,
        actorId: e.actorId,
        at: e.at,
      }];
    }).slice(0, 50);
    return { workflows: this.catalog, grants, audit };
  }

  async grant(orgId: string, actorId: string, capabilityCategory: string, sideEffectCap: GrantableSideEffectCap): Promise<WorkflowCapabilityGrant> {
    await this.requireAdmin(orgId, actorId, "setWorkflowCapabilityGrant", capabilityCategory);
    this.requireKnown(capabilityCategory);
    const row = await this.deps.store.upsert(orgId, capabilityCategory, sideEffectCap, actorId, (s, before) =>
      this.audit(s, orgId, actorId, "capability-updated", capabilityCategory, effectiveCap(before), sideEffectCap));
    return toView(capabilityCategory, row);
  }

  async revoke(orgId: string, actorId: string, capabilityCategory: string): Promise<WorkflowCapabilityGrant> {
    await this.requireAdmin(orgId, actorId, "revokeWorkflowCapabilityGrant", capabilityCategory);
    this.requireKnown(capabilityCategory);
    await this.deps.store.remove(orgId, capabilityCategory, (s, before) =>
      this.audit(s, orgId, actorId, "capability-disabled", capabilityCategory, effectiveCap(before), DEFAULT_CAP));
    return toView(capabilityCategory, null);
  }

  private audit(
    s: TenantSession, orgId: string, actorId: string, type: "capability-updated" | "capability-disabled",
    capabilityCategory: string, from: WorkflowSideEffectClass, to: WorkflowSideEffectClass,
  ) {
    return this.deps.provenanceWriter.appendWithin(s, {
      orgId: toOrgId(orgId),
      type,
      actorId,
      target: { kind: "capability", id: `${C.WORKFLOW_CAPABILITY_AUDIT_TARGET_PREFIX}${capabilityCategory}` },
      detail: { surface: "workflow-capability-grant", capabilityCategory, from, to },
    });
  }

  private requireKnown(capabilityCategory: string): void {
    if (!this.allowed.has(capabilityCategory)) throw new WorkflowCapabilityGrantError("UNKNOWN_CAPABILITY");
  }

  private async requireAdmin(orgId: string, actorId: string, operation: string, capabilityCategory?: string): Promise<void> {
    const membership = await this.deps.identity.findOrgMembership(actorId, toOrgId(orgId));
    if (membership?.orgRole === "admin") return;
    if (membership !== null) {
      await this.deps.provenanceWriter.append({
        orgId: toOrgId(orgId),
        type: "unauthorized-attempt",
        actorId,
        target: { kind: "organization", id: orgId },
        detail: { operation, capabilityCategory: capabilityCategory ?? null, orgRole: membership.orgRole, reasonCode: "NOT_ORG_ADMIN" },
      });
    }
    throw new WorkflowCapabilityGrantError("NOT_ORG_ADMIN");
  }
}
