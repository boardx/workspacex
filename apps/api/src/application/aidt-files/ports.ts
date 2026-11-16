import type { Principal } from "../../domain/principal";
import type { IdentityRepository } from "../identity/ports";
import type { ArtifactRepository, IdempotencyHit } from "../artifact/ports";
import type { QuarantineRepository } from "../files/upload-ports";
import type { ProvenanceWriter } from "../provenance/ports";
import type { Guarded } from "../security/permission-filter";
import type { IngestionStatus } from "../../domain/files/ingestion-visibility";

export type RawActor = Principal & { projectId: string };
/** A real receipt for one immutable uploaded version, distinct from the version/job ids. */
export interface RawRun {
  id: string; projectId: string; artifactId: string; versionId: string;
  filename: string; mime: string; sha256: string; sizeBytes: number;
}
export interface RawContent extends RawRun {
  objectKey: string; versionHash: string; history: IngestionStatus[]; failed: boolean;
  /** This immutable receipt submission, not the original version author nor the reader. */
  submittedBy: string; submittedAt: string;
}
export interface RawTransaction {
  identity: IdentityRepository;
  project: { aidt: boolean; status: string; orgStatus: string } | null;
  artifacts: ArtifactRepository;
  quarantine: QuarantineRepository;
  provenance: ProvenanceWriter;
  /** Existing metadata must match; a duplicate can never broaden visibility/confidentiality. */
  findReusableVersion(contentHash: string, pipelineVersion: string, parserVersion: string, visibility: string, confidential: boolean, agenda: string | null): Promise<IdempotencyHit | null>;
  bindVisibility(artifactId: string, scope: "org-wide" | "team-only", teamId: string | null): Promise<void>;
  insertRun(run: RawRun): Promise<void>;
  content(runId: string): Promise<Guarded<RawContent> | null>;
}
export interface AidtRawFilesRepository {
  inProject<T>(actor: RawActor, fn: (tx: RawTransaction) => Promise<T>): Promise<T>;
  projectForRun(actor: Principal, runId: string): Promise<string | null>;
}
export const AIDT_RAW_FILES_SERVICE = Symbol("AidtRawFilesService");
