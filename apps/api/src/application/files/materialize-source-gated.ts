/**
 * F43 -- uc-22-3 R11 item 3: the file-first "total gate" wrapping F41's `materializeSource`.
 *
 * Three things F41 deliberately left undone (its own scope is V1/D-03a only):
 *
 *   - V9 "物化失败可见，不阻断业务": a failed materialize must not propagate as a thrown
 *     error the business flow has to handle -- it is caught HERE and turned into a durable
 *     `MaterializationFailureRecord` (`materialize-ready-ports.ts`) plus a `"failed"` result,
 *     so a caller (a survey close, an interview end, ...) can proceed with its own business
 *     outcome regardless of whether the file-side write succeeded.
 *
 *   - V6 "AI 生成物缺 provenance.json ⇒ REVIEW_PENDING '溯源信息缺失'": only the `generated`
 *     source is affected. `materializeSource` (F41) treats `provenance.json` as required
 *     (throws `SourceMaterializationFailedError` if absent) -- correct for "does a version
 *     get written at all" but the wrong rule for THIS gate: a generated version missing
 *     provenance should still exist (R7 "不存在业务对象存在但浏览器什么都没有的静默态"),
 *     just parked `REVIEW_PENDING` rather than made `READY`. So for `generated` calls with no
 *     `provenance.json`, this writes `content.md` directly (`materializeGeneratedContentOnly`
 *     below) using the SAME write-once / hash / verify discipline `materializeSource` uses,
 *     rather than loosening F41's own signed `SEVEN_SOURCE_FILE_PLAN` table.
 *
 *   - V10 "同 source_ref 内容未变时不新增版本，只更新 provenance_events 核对时间": checked
 *     BEFORE calling into F41 at all, via `SourceRefIndex`. A byte-identical retry (the same
 *     event replayed, or a debounce window firing twice for the same content) records a
 *     recheck event and returns `"unchanged"` rather than creating a second version.
 *
 * ⚠ The recheck audit event reuses `"transformed"` (@repo/contracts `ProvenanceEventType`
 * has no dedicated "content re-checked, nothing changed" member) -- the same documented
 * stand-in precedent `application/chat/mutate-thread.ts`'s own `CHAT_LIFECYCLE_AUDIT_TYPE`
 * already uses for F109's own missing enum members (ADR-101's fourth, "顶包" option), rather
 * than adding a fifth ad-hoc member to that shared, signed enum for this one feature.
 */
import { computeContentHash, versionContentHash } from "../../domain/artifact/content-hash";
import { storageKey } from "../../domain/artifact/materialization";
import { gateReadyForProvenance } from "../../domain/files/materialize-ready-gate";
import { requiredSourceFiles, SEVEN_SOURCE_FILE_PLAN } from "../../domain/files/seven-source-plan";
import type { MaterializationSourceType } from "../../domain/files/materialization-events";
import type { OrgId } from "../../domain/org-id";
import {
  materializeSource,
  SourceDependencyUnavailableError,
  SourceMaterializationFailedError,
  SourceVersionKeyTakenError,
  type MaterializeSourceDeps,
  type MaterializeSourceInput,
  type MaterializeSourceResult,
} from "./materialize-source";
import type { MaterializationFailureRepository, SourceRefIndex } from "./materialize-ready-ports";
import type { ProvenanceWriter } from "../provenance/ports";
import type { IdFactory } from "../artifact/ports";

/** See this file's header -- a documented stand-in, not a new contract member. */
export const MATERIALIZE_RECHECK_AUDIT_TYPE = "transformed";

export interface MaterializeGatedInput {
  readonly orgId: OrgId;
  readonly projectId: string | null;
  readonly sourceType: MaterializationSourceType;
  /** The business object id (R1's source_ref). */
  readonly sourceRef: string;
  readonly actorId: string;
  readonly agendaSegmentId?: string | null;
  readonly parts: Readonly<Record<string, Uint8Array>>;
}

export type MaterializeGatedResult =
  | {
      readonly kind: "materialized";
      readonly artifactId: string;
      readonly versionId: string;
      readonly versionNumber: number;
      readonly fileNames: readonly string[];
      readonly readyState: "READY" | "REVIEW_PENDING";
      readonly reviewReason: string | null;
    }
  | {
      readonly kind: "unchanged";
      readonly artifactId: string;
      readonly versionId: string;
      readonly versionNumber: number;
      readonly provenanceEventId: string;
    }
  | {
      readonly kind: "failed";
      readonly failureId: string;
      readonly reason: string;
      readonly retryable: boolean;
    };

export interface MaterializeGatedDeps extends MaterializeSourceDeps {
  readonly ids: IdFactory;
  readonly index: SourceRefIndex;
  readonly failures: MaterializationFailureRepository;
  readonly provenance: ProvenanceWriter;
}

/** The combined hash V10 compares against -- every part the caller supplied for this call,
 *  in the plan's declared order, so omitting (or newly including) an optional part is
 *  correctly seen as a CHANGE rather than compared only over the intersection. */
function combinedHash(sourceType: MaterializationSourceType, parts: Readonly<Record<string, Uint8Array>>): string {
  const hashes = SEVEN_SOURCE_FILE_PLAN[sourceType]
    .filter((f) => parts[f.name] !== undefined && parts[f.name]!.byteLength > 0)
    .map((f) => computeContentHash(parts[f.name]!));
  return versionContentHash(hashes);
}

export async function materializeSourceGated(
  deps: MaterializeGatedDeps,
  input: MaterializeGatedInput,
): Promise<MaterializeGatedResult> {
  const { orgId, sourceType, sourceRef } = input;
  const contentHash = combinedHash(sourceType, input.parts);

  // V10: identical content for a source_ref already resolved -- no new version, just a
  // recheck event (its append timestamp IS the "核对时间" this records).
  const existing = await deps.index.find(orgId, sourceType, sourceRef);
  if (existing !== null && existing.contentHash === contentHash) {
    const provenanceEventId = await deps.provenance.append({
      orgId,
      type: MATERIALIZE_RECHECK_AUDIT_TYPE,
      actorId: input.actorId,
      target: { kind: "artifact", id: existing.artifactId },
      detail: { sourceType, sourceRef, versionId: existing.versionId, recheck: true },
    });
    return {
      kind: "unchanged",
      artifactId: existing.artifactId,
      versionId: existing.versionId,
      versionNumber: existing.versionNumber,
      provenanceEventId,
    };
  }

  const readyGate = gateReadyForProvenance(sourceType, input.parts);

  try {
    const result = await materializeSourceForGate(deps, {
      orgId,
      projectId: input.projectId,
      sourceType,
      sourceRef,
      actorId: input.actorId,
      agendaSegmentId: input.agendaSegmentId,
      parts: input.parts,
    });

    await deps.index.record(orgId, sourceType, sourceRef, {
      artifactId: result.artifactId,
      versionId: result.versionId,
      versionNumber: result.versionNumber,
      contentHash,
    });

    // A previously-open failure for this exact source_ref is now moot -- the retry succeeded.
    const openFailure = await deps.failures.findOpen(orgId, sourceType, sourceRef);
    if (openFailure !== null) await deps.failures.resolve(orgId, openFailure.id);

    return {
      kind: "materialized",
      artifactId: result.artifactId,
      versionId: result.versionId,
      versionNumber: result.versionNumber,
      fileNames: result.fileNames,
      readyState: readyGate.ready ? "READY" : "REVIEW_PENDING",
      reviewReason: readyGate.ready ? null : readyGate.reason,
    };
  } catch (e) {
    const reason = failureReason(e);
    const retryable = !(e instanceof SourceVersionKeyTakenError);
    const failureId = await deps.failures.record({ orgId, sourceType, sourceRef, reason, retryable });
    return { kind: "failed", failureId, reason, retryable };
  }
}

function failureReason(e: unknown): string {
  if (e instanceof SourceMaterializationFailedError) return e.message;
  if (e instanceof SourceDependencyUnavailableError) return `依赖不可用：${e.message}`;
  if (e instanceof SourceVersionKeyTakenError) return `版本键冲突：${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/**
 * F41's `materializeSource` refuses the whole call when a REQUIRED file per
 * `SEVEN_SOURCE_FILE_PLAN` is missing -- correct for every source except `generated`'s
 * `provenance.json`, which V6's gate demotes from "blocks materialization" to "blocks READY
 * only". So for `generated` calls with no provenance, this writes directly (bypassing F41's
 * required-file check for that one file) using the exact same write-once / hash / verify
 * discipline `materializeSource` uses -- `content.md` is still required and still enforced.
 * Every other source, and every `generated` call that DOES include provenance, goes through
 * F41's own function unchanged.
 */
async function materializeSourceForGate(
  deps: MaterializeSourceDeps,
  input: MaterializeSourceInput,
): Promise<MaterializeSourceResult> {
  if (input.sourceType !== "generated") return materializeSource(deps, input);

  const provenanceBytes = input.parts["provenance.json"];
  const hasProvenance = provenanceBytes !== undefined && provenanceBytes.byteLength > 0;
  if (hasProvenance) return materializeSource(deps, input);

  const contentBytes = input.parts["content.md"];
  if (contentBytes === undefined || contentBytes.byteLength === 0) {
    const required = requiredSourceFiles("generated").map((f) => f.name);
    throw new SourceMaterializationFailedError(
      `source "generated" (${input.sourceRef}) requires ${required.join(", ")}`,
    );
  }

  return materializeGeneratedContentOnly(deps, input, contentBytes);
}

/** Mirrors `materializeSource`'s own body (write-once, read back, verify hash, one artifact +
 *  one version), narrowed to the single `content.md` part -- the `generated`/no-provenance
 *  case this gate demotes to REVIEW_PENDING rather than refusing outright. */
async function materializeGeneratedContentOnly(
  deps: MaterializeSourceDeps,
  input: MaterializeSourceInput,
  contentBytes: Uint8Array,
): Promise<MaterializeSourceResult> {
  const { store, repo, ids } = deps;
  const artifactId = ids.next("art");
  await repo.createArtifact({
    id: artifactId,
    orgId: input.orgId,
    projectId: input.projectId,
    source: "ai-generated",
    title: `generated:${input.sourceRef}`,
    createdBy: input.actorId,
    synthesized: true,
    agendaSegmentId: input.agendaSegmentId,
    ingestionStatus: "REVIEW_PENDING",
  });

  const versionNumber = (await repo.headVersionNumber(input.orgId, artifactId)) + 1;
  const versionId = ids.next("ver");
  const key = storageKey({ orgId: input.orgId, artifactId, versionNumber, fileName: "content.md" });

  await store.putOnce(key, contentBytes, "text/markdown");
  const back = await store.get(key);
  if (back === null || back.byteLength === 0) {
    throw new SourceMaterializationFailedError(`object ${key} is not readable after write`);
  }
  const fileHash = computeContentHash(back);
  const contentHash = versionContentHash([fileHash]);

  await repo.createVersion({
    id: versionId,
    orgId: input.orgId,
    artifactId,
    versionNumber,
    objectStorageKey: key,
    contentHash,
    mime: "text/markdown",
    sizeBytes: back.byteLength,
    pinnedBy: input.actorId,
    contextPackId: null,
    derivedFrom: null,
    changeSource: "materialize",
  });

  return {
    artifactId,
    versionId,
    versionNumber,
    materializedKeys: [key],
    fileNames: ["content.md"],
    contentHash,
  };
}
