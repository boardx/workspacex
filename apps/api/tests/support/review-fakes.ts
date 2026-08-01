/**
 * In-memory doubles for F39's two new ports (`application/files/review-ports.ts`).
 * Same rationale as `artifact-fakes.ts`'s header: no local Postgres (issue #74).
 */
import type {
  ConfidentialityLookup,
  NewReviewDisposition,
  ReviewDispositionRecord,
  ReviewDispositionRepository,
} from "../../src/application/files/review-ports";
import type { OrgId } from "../../src/domain/org-id";

export class FakeConfidentialityLookup implements ConfidentialityLookup {
  private readonly flags = new Map<string, boolean>();

  setConfidential(artifactId: string, value: boolean): void {
    this.flags.set(artifactId, value);
  }

  async isConfidential(_orgId: OrgId, artifactId: string): Promise<boolean> {
    return this.flags.get(artifactId) ?? false;
  }
}

export class FakeReviewDispositionRepository implements ReviewDispositionRepository {
  readonly rows = new Map<string, ReviewDispositionRecord>();

  async record(d: NewReviewDisposition): Promise<void> {
    this.rows.set(d.artifactId, {
      artifactId: d.artifactId,
      decision: d.decision,
      note: d.note,
      actorId: d.actorId,
      resolvedAt: "2026-08-01T00:00:00Z",
    });
  }

  async find(_orgId: OrgId, artifactId: string): Promise<ReviewDispositionRecord | null> {
    return this.rows.get(artifactId) ?? null;
  }
}
