import type { SandboxInputFile } from "@repo/skill-sandbox/input-files";
import type { OrgId } from "../../domain/org-id";

export interface PreparedArtifactContinuation {
  readonly inputFiles: readonly SandboxInputFile[];
  /** Model receives a sandbox-relative path, never the source bytes or storage key. */
  readonly instruction: string;
}
export interface ArtifactContinuationReader {
  prepare(orgId: OrgId, runId: string): Promise<PreparedArtifactContinuation | null>;
}
export const ARTIFACT_CONTINUATION_READER = Symbol("ArtifactContinuationReader");
