/**
 * In-memory fakes for F46's compliance-side use cases (`applyLegalHold`/`releaseLegalHold`/
 * `listTrashQueue`/`getDeletionReceipt`) -- per issue #74 (no local Postgres-backed runs for
 * this worker), and the same "a fake, not a stub" discipline `tests/support/retention-fakes.ts`
 * documents: rows really get written and really get read back, so an assertion reads what
 * was actually stored, not what the code under test claims.
 */
import type {
  AclObjectRef,
  BindingRow,
  DecisionIdFactory,
  IdentityRepository,
  OrgMembershipRow,
  OrganizationRow,
  ProjectMembershipRow,
} from "../../src/application/identity/ports";
import type { OrgId } from "../../src/domain/org-id";
import type { ProjectRole } from "../../src/domain/identity/roles";
import { guard, type Guarded } from "../../src/application/security/permission-filter";
import type {
  DeletableArtifactLookup,
  DeleteImpactCounts,
  DeleteImpactRepository,
  LegalHoldGate,
} from "../../src/application/files/deletion-ports";
import type { LegalHoldWriteRepository } from "../../src/application/files/legal-hold-ports";
import type { ActiveHold } from "../../src/domain/files/legal-hold";
import type { TrashQueueRepository, TrashQueueStatus } from "../../src/application/files/trash-queue-ports";
import type { DeletionReceiptRepository } from "../../src/application/files/physical-delete-ports";
import type { DeletionReceipt } from "../../src/domain/files/physical-delete";
import type { DeletionTaskRepository, DeletionTaskRow, NewDeletionTask } from "../../src/application/files/deletion-ports";
import type { CascadeResultEntry } from "../../src/domain/files/deletion-cascade";
import type { ProvenanceAppendInput, ProvenanceWriter } from "../../src/application/provenance/ports";
import type { IdFactory } from "../../src/application/artifact/ports";

export const ORG = "org-f46-trash" as OrgId;
export const PROJECT = "prj-f46-trash";
export const FACILITATOR = "user-facilitator";
export const MEMBER = "user-member";

export class FakeIdentityRepository implements IdentityRepository {
  private readonly projectRoles = new Map<string, ProjectRole>([[FACILITATOR, "facilitator"], [MEMBER, "member"]]);

  async findOrganization(): Promise<OrganizationRow | null> {
    return { id: ORG, name: "f46 org", kind: "organization", team: null, avatarUrl: null };
  }
  async findOrgMembership(): Promise<OrgMembershipRow | null> {
    return { orgRole: "consultant", teamId: null };
  }
  async findProjectMembership(userId: string): Promise<ProjectMembershipRow | null> {
    const role = this.projectRoles.get(userId);
    return role === undefined ? null : { projectRole: role, groupId: null, isHost: false };
  }
  async findBindings(_o: OrgId, _x: readonly AclObjectRef[]): Promise<Map<string, BindingRow>> {
    return new Map();
  }
  async listMemberships(): Promise<readonly { orgId: string; orgRole: "consultant" }[]> {
    return [{ orgId: ORG, orgRole: "consultant" }];
  }
  async ensurePersonalLocalOrg(): Promise<OrganizationRow> {
    throw new Error("not used by these fakes");
  }
  async findPersonalLocalOrg(): Promise<OrganizationRow | null> {
    return null;
  }
  async countOrgMembers(): Promise<number> {
    return 2;
  }
}

export class SeqDecisionIds implements DecisionIdFactory {
  private n = 0;
  next(): string {
    this.n += 1;
    return `decision-${this.n}`;
  }
}

export class SeqIdFactory implements IdFactory {
  private counters = new Map<string, number>();
  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}-${n}`;
  }
}

export interface FakeArtifactRow {
  readonly artifactId: string;
  readonly projectId: string | null;
  readonly title: string;
}

export class FakeDeleteImpactRepository implements DeleteImpactRepository {
  private readonly rows = new Map<string, FakeArtifactRow>();
  countsByArtifact = new Map<string, DeleteImpactCounts>();

  add(row: FakeArtifactRow): void {
    this.rows.set(row.artifactId, row);
  }

  async findDeletable(input: { orgId: OrgId; artifactId: string }): Promise<DeletableArtifactLookup | null> {
    const row = this.rows.get(input.artifactId);
    if (!row) return null;
    return {
      artifactId: row.artifactId,
      projectId: row.projectId,
      artifact: guard({ kind: "artifact", id: row.artifactId }, { title: row.title }) as Guarded<{ title: string }>,
    };
  }

  async countsFor(_orgId: OrgId, artifactId: string): Promise<DeleteImpactCounts> {
    return (
      this.countsByArtifact.get(artifactId) ?? {
        versionCount: 0,
        derivedCount: 0,
        segmentCount: 0,
        referencingClaims: [],
        referencingReportSections: [],
        exportedOutOfOrg: [],
      }
    );
  }
}

export class FakeLegalHoldRepository implements LegalHoldGate, LegalHoldWriteRepository {
  private readonly active = new Map<string, ActiveHold>();
  readonly released: { holdId: string; releasedBy: string; releasedAt: Date; releaseReason: string }[] = [];

  async isActive(_orgId: OrgId, artifactId: string): Promise<boolean> {
    return this.active.has(artifactId);
  }

  async getActive(_orgId: OrgId, artifactId: string): Promise<ActiveHold | null> {
    return this.active.get(artifactId) ?? null;
  }

  async apply(input: {
    holdId: string; artifactId: string; reason: string; appliedBy: string; appliedAt: Date;
  }): Promise<void> {
    this.active.set(input.artifactId, {
      holdId: input.holdId, artifactId: input.artifactId, reason: input.reason,
      appliedBy: input.appliedBy, appliedAt: input.appliedAt,
    });
  }

  async release(input: { holdId: string; releasedBy: string; releasedAt: Date; releaseReason: string }): Promise<void> {
    for (const [artifactId, hold] of this.active) {
      if (hold.holdId === input.holdId) this.active.delete(artifactId);
    }
    this.released.push(input);
  }
}

export class FakeTrashQueueRepository implements TrashQueueRepository {
  private readonly byProject = new Map<string, { taskId: string; status: TrashQueueStatus }[]>();

  seed(projectId: string, taskId: string, status: TrashQueueStatus): void {
    const list = this.byProject.get(projectId) ?? [];
    list.push({ taskId, status });
    this.byProject.set(projectId, list);
  }

  async listTaskIds(_orgId: OrgId, projectId: string, status: TrashQueueStatus | null): Promise<readonly string[]> {
    const list = this.byProject.get(projectId) ?? [];
    return list.filter((r) => status === null || r.status === status).map((r) => r.taskId);
  }
}

export class FakeDeletionTaskRepository implements DeletionTaskRepository {
  private readonly rows = new Map<string, DeletionTaskRow>();

  async create(input: NewDeletionTask): Promise<void> {
    this.rows.set(input.id, {
      taskId: input.id,
      artifactId: input.artifactId,
      status: input.status,
      requestedAt: input.requestedAt,
      logicalInvalidationDeadline: input.logicalInvalidationDeadline,
      physicalDeletionDeadline: input.physicalDeletionDeadline,
      receiptId: null,
      cascadeResults: input.cascadeResults,
    });
  }

  async getTask(_orgId: OrgId, taskId: string): Promise<DeletionTaskRow | null> {
    return this.rows.get(taskId) ?? null;
  }

  /** Test-only direct write, for seeding a `'done'` task without going through the worker. */
  seed(row: DeletionTaskRow): void {
    this.rows.set(row.taskId, row);
  }

  setCascadeResults(taskId: string, results: readonly CascadeResultEntry[]): void {
    const row = this.rows.get(taskId);
    if (!row) throw new Error(`no task ${taskId}`);
    this.rows.set(taskId, { ...row, cascadeResults: results });
  }

  setStatus(taskId: string, status: DeletionTaskRow["status"]): void {
    const row = this.rows.get(taskId);
    if (!row) throw new Error(`no task ${taskId}`);
    this.rows.set(taskId, { ...row, status });
  }
}

export class FakeDeletionReceiptRepository implements DeletionReceiptRepository {
  private readonly rows = new Map<string, DeletionReceipt>();

  async save(_orgId: OrgId, receipt: DeletionReceipt): Promise<void> {
    this.rows.set(receipt.taskId, receipt);
  }

  async find(_orgId: OrgId, taskId: string): Promise<DeletionReceipt | null> {
    const row = this.rows.get(taskId);
    // Mirrors the real Postgres repository: `coverage` is never persisted (see
    // `physical-delete-ports.ts`'s `DeletionReceiptRepository` header) -- the caller
    // (`get-deletion-receipt.ts`) joins it in from the task's cascade results.
    return row === undefined ? null : { ...row, coverage: [] };
  }
}

export class FakeProvenanceWriter implements ProvenanceWriter {
  readonly events: ProvenanceAppendInput[] = [];
  async append(input: ProvenanceAppendInput): Promise<string> {
    this.events.push(input);
    return `prov-${this.events.length}`;
  }
  async appendWithin(_session: unknown, input: ProvenanceAppendInput): Promise<string> {
    return this.append(input);
  }
}
