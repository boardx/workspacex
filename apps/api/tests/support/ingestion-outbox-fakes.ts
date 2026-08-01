/**
 * In-memory double for F36's `IngestionOutboxRepository` (`application/files/ingestion-ports.ts`).
 *
 * Same rationale as `artifact-fakes.ts`'s header: F37's worker-facing tests (the four
 * adapters, segment/anchor modality) need to drive `runIngestionWorkerTick`/
 * `replayIngestionRun` end to end without PostgreSQL (issue #74), and a fake that really
 * keeps job rows -- rather than one that only returns canned responses -- is what makes
 * "the SECOND tick claims the SEGMENTED job the first tick's `completeAndAdvance` enqueued"
 * an assertion about actual state instead of a assumption baked into the test.
 */
import type {
  IngestionOutboxJob,
  IngestionOutboxRepository,
  NewIngestionOutboxJob,
} from "../../src/application/files/ingestion-ports";
import type { IngestionStatus } from "../../src/domain/files/ingestion-pipeline";
import type { OrgId } from "../../src/domain/org-id";

interface Row {
  id: string;
  orgId: OrgId;
  artifactId: string;
  artifactVersionId: string;
  step: IngestionOutboxJob["step"];
  attempts: number;
  status: "pending" | "processing" | "failed";
}

export class InMemoryIngestionOutbox implements IngestionOutboxRepository {
  private readonly rows = new Map<string, Row>();
  private seq = 0;
  /** `getIngestionRun.history`'s in-memory shadow -- not part of the port, tests read it directly. */
  readonly history = new Map<string, IngestionStatus[]>();

  private nextId(): string {
    this.seq += 1;
    return `outbox-${this.seq}`;
  }

  async enqueue(job: NewIngestionOutboxJob): Promise<void> {
    const dup = [...this.rows.values()].some(
      (r) => r.artifactVersionId === job.artifactVersionId && r.step === job.step,
    );
    if (dup) return; // ON CONFLICT ... DO NOTHING, same as the real table's unique index.
    this.rows.set(job.id, { ...job, attempts: 0, status: "pending" });
  }

  async claimNext(orgId: OrgId, _workerId: string, _staleAfterMs: number): Promise<IngestionOutboxJob | null> {
    const row = [...this.rows.values()].find((r) => r.orgId === orgId && r.status !== "processing");
    if (row === undefined) return null;
    row.status = "processing";
    return asJob(row);
  }

  async claimForVersion(orgId: OrgId, artifactVersionId: string, _workerId: string): Promise<IngestionOutboxJob | null> {
    const row = [...this.rows.values()].find(
      (r) => r.orgId === orgId && r.artifactVersionId === artifactVersionId && r.status !== "processing",
    );
    if (row === undefined) return null;
    row.status = "processing";
    return asJob(row);
  }

  async completeAndAdvance(
    orgId: OrgId,
    jobId: string,
    nextStatus: IngestionStatus,
    nextStep: IngestionOutboxJob["step"] | null,
  ): Promise<void> {
    const row = this.rows.get(jobId);
    if (row === undefined) throw new Error(`no such job ${jobId}`);
    this.rows.delete(jobId);
    const h = this.history.get(row.artifactVersionId) ?? [];
    h.push(nextStatus);
    this.history.set(row.artifactVersionId, h);
    if (nextStep !== null) {
      const id = this.nextId();
      this.rows.set(id, {
        id,
        orgId,
        artifactId: row.artifactId,
        artifactVersionId: row.artifactVersionId,
        step: nextStep,
        attempts: 0,
        status: "pending",
      });
    }
  }

  async markFailed(_orgId: OrgId, jobId: string, _error: string): Promise<void> {
    const row = this.rows.get(jobId);
    if (row === undefined) return;
    row.attempts += 1;
    row.status = "failed";
  }

  async findByVersion(orgId: OrgId, artifactVersionId: string): Promise<IngestionOutboxJob | null> {
    const row = [...this.rows.values()].find((r) => r.orgId === orgId && r.artifactVersionId === artifactVersionId);
    return row === undefined ? null : asJob(row);
  }
}

function asJob(row: Row): IngestionOutboxJob {
  return {
    id: row.id,
    orgId: row.orgId,
    artifactId: row.artifactId,
    artifactVersionId: row.artifactVersionId,
    step: row.step,
    attempts: row.attempts,
  };
}
