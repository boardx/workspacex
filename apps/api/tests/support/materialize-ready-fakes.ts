/**
 * F43 -- in-memory doubles for `materialize-ready-ports.ts`, following the same "genuinely
 * keeps rows" discipline `tests/support/artifact-fakes.ts` documents for itself (issue #74:
 * no local Postgres for this worker's test runs).
 */
import type { MaterializationSourceType } from "../../src/domain/files/materialization-events";
import type {
  MaterializationFailureRecord,
  NewMaterializationFailure,
  SourceRefIndex,
  SourceRefRecord,
} from "../../src/application/files/materialize-ready-ports";
import type { OrgId } from "../../src/domain/org-id";

function key(orgId: OrgId, sourceType: MaterializationSourceType, sourceRef: string): string {
  return `${orgId}::${sourceType}::${sourceRef}`;
}

export class FakeSourceRefIndex implements SourceRefIndex {
  private readonly rows = new Map<string, SourceRefRecord>();

  async find(orgId: OrgId, sourceType: MaterializationSourceType, sourceRef: string): Promise<SourceRefRecord | null> {
    return this.rows.get(key(orgId, sourceType, sourceRef)) ?? null;
  }

  async record(
    orgId: OrgId,
    sourceType: MaterializationSourceType,
    sourceRef: string,
    entry: SourceRefRecord,
  ): Promise<void> {
    this.rows.set(key(orgId, sourceType, sourceRef), entry);
  }
}

export class FakeMaterializationFailureRepository {
  readonly rows = new Map<string, MaterializationFailureRecord>();
  private seq = 0;

  async record(f: NewMaterializationFailure): Promise<string> {
    this.seq += 1;
    const id = `fail-${this.seq}`;
    this.rows.set(id, {
      id,
      orgId: f.orgId,
      sourceType: f.sourceType,
      sourceRef: f.sourceRef,
      reason: f.reason,
      retryable: f.retryable,
      occurredAt: "2026-08-02T00:00:00Z",
      resolvedAt: null,
    });
    return id;
  }

  async findOpen(
    orgId: OrgId,
    sourceType: MaterializationSourceType,
    sourceRef: string,
  ): Promise<MaterializationFailureRecord | null> {
    const match = [...this.rows.values()].find(
      (r) => r.orgId === orgId && r.sourceType === sourceType && r.sourceRef === sourceRef && r.resolvedAt === null,
    );
    return match ?? null;
  }

  async resolve(orgId: OrgId, failureId: string): Promise<void> {
    const row = this.rows.get(failureId);
    if (row === undefined || row.orgId !== orgId) return;
    this.rows.set(failureId, { ...row, resolvedAt: "2026-08-02T00:05:00Z" });
  }

  async listOpen(orgId: OrgId): Promise<readonly MaterializationFailureRecord[]> {
    return [...this.rows.values()].filter((r) => r.orgId === orgId && r.resolvedAt === null);
  }
}
