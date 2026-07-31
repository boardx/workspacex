/**
 * In-memory doubles for F33's export ports.
 *
 * These deliberately do NOT touch PostgreSQL. `createExportJob`'s structural claims (V4: zip
 * layout ≡ tree grouping, manifest sha256 per file, count = manifest entries, threshold
 * rejects without a half-built zip) are properties of `export-manifest.ts` + `zip-codec.ts` +
 * `export-artifacts.ts`'s own control flow, not of the SQL visibility predicate -- that
 * predicate is F31's `wsx_visible_artifacts()`, already asserted against real Postgres in
 * `tree-list-metadata.test.ts` / `visible-equals-searchable.test.ts` / this bundle's own
 * `fts-search-six-filters.test.ts`. Re-deriving it here would test the same predicate a third
 * time and add nothing; what these fakes let a test check is whether `createExportJob` wires
 * the SELECTION through to whatever repository it is given, which is a property of this
 * feature's own code.
 */
import type {
  ExportableRow,
  ExportContentRepository,
  ExportJobRecord,
  ExportJobRepository,
  ExportSelection,
  NewExportJob,
} from "../../src/application/files/export-ports";
import type { DownloadUrlBuilder } from "../../src/application/files/download-ports";
import { guard } from "../../src/application/security/permission-filter";
import type { OrgId } from "../../src/domain/org-id";

export class FakeExportContentRepository implements ExportContentRepository {
  readonly calls: { readonly selection: ExportSelection }[] = [];

  constructor(private readonly rows: readonly ExportableRow[]) {}

  async visibleExportRows(input: {
    readonly orgId: OrgId;
    readonly projectId: string;
    readonly requesterTeamId: string | null;
    readonly selection: ExportSelection;
  }) {
    this.calls.push({ selection: input.selection });
    return this.rows.map((r) => guard({ kind: "artifact", id: r.artifactId }, r));
  }
}

/** Keeps the FULL `NewExportJob` (including `objectKey`), not just the contract-shaped record
 *  -- a test needs the object key to go fetch the zip bytes back out of the object store. */
export class InMemoryExportJobRepository implements ExportJobRepository {
  readonly raw = new Map<string, NewExportJob>();

  async saveDone(job: NewExportJob): Promise<void> {
    this.raw.set(job.jobId, job);
  }

  async findById(input: { readonly orgId: OrgId; readonly jobId: string }):
    Promise<{ readonly projectId: string; readonly job: ExportJobRecord } | null> {
    const job = this.raw.get(input.jobId);
    if (!job) return null;
    return {
      projectId: job.projectId,
      job: {
        jobId: job.jobId,
        status: "done",
        downloadUrl: job.downloadUrl,
        expiresAt: job.expiresAt.toISOString(),
        failureReason: null,
      },
    };
  }
}

export class FakeDownloadUrlBuilder implements DownloadUrlBuilder {
  build(token: string): string {
    return `https://downloads.test/${token}`;
  }
}
