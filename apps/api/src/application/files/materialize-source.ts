/**
 * F41 -- uc-22-3 R3: the consumer half of F40's queue. A `MaterializationJob` (F40,
 * `application/files/materialize-ports.ts`) names WHICH business event fired; this module is
 * what turns that claim into real files, once the caller has assembled the bytes (each
 * per-source producer's own job -- see this feature's `【跨分片依赖待确认】` note; this
 * module does not know how to render a survey response or a canvas, only how to write
 * whatever bytes it is handed under the RIGHT fixed file names, per `SEVEN_SOURCE_FILE_PLAN`).
 *
 * ## Reuses F04's write-once / read-back-and-verify discipline, does not reinvent it
 *
 * Same order of operations as `application/artifact/materialize-artifact.ts` (object storage
 * first, hash + read-back second, PostgreSQL row last) and the SAME two ports
 * (`ArtifactRepository` / `ObjectStore` from `application/artifact/ports.ts`) -- no second
 * storage path, per this feature's own "不另建入库路径". It is a SEPARATE function, not a
 * call into `materializeArtifact`, because that function derives its required-file plan from
 * `MATERIALIZATION_PLAN[ArtifactSource]` internally, and `workshop`/`canvas` have no
 * `ArtifactSource` member of their own to key that lookup with (see
 * `domain/files/seven-source-plan.ts`'s header). This module takes the plan as an explicit
 * parameter instead, so callers materializing any of the seven `MaterializationSourceType`s
 * -- survey/conversation/interview/workshop/research/canvas/generated -- all go through the
 * same code path regardless of which `ArtifactSource` their rows end up tagged with.
 *
 * ## `sourceRef` is carried in the title, not a real column -- a stated, precedented gap
 *
 * `NewArtifact` (F04's port) has no `sourceRef` field; the real `artifacts` table has none
 * either. `materialize-file-first.ts` (F73) already hit this and worked around it by folding
 * the business object id into `title` (`` `${sessionId} · ${fileName}` ``) rather than adding
 * a column no other F04 caller asked for. This module does the same
 * (`` `${sourceType}:${sourceRef}` ``) for the same reason: a real `source_ref` column, and
 * the `GET /projects/:id/artifacts?source_ref=...` endpoint V1 describes, are follow-up
 * infra work for whichever feature first needs to query by it -- not invented here as a
 * side effect of materializing.
 */
import { computeContentHash, verifyContentHash, versionContentHash } from "../../domain/artifact/content-hash";
import { storageKey } from "../../domain/artifact/materialization";
import { strictestConfidential } from "../../domain/files/generated-visibility";
import {
  requiredSourceFiles,
  SEVEN_SOURCE_FILE_PLAN,
  SOURCE_TYPE_ARTIFACT_SOURCE_TAG,
  type SourceMaterializedFile,
} from "../../domain/files/seven-source-plan";
import type { MaterializationSourceType } from "../../domain/files/materialization-events";
import type { OrgId } from "../../domain/org-id";
import {
  ObjectExistsError,
  ObjectStoreUnavailableError,
  type ArtifactRepository,
  type IdFactory,
  type ObjectStore,
} from "../artifact/ports";

export interface MaterializeSourceDeps {
  readonly store: ObjectStore;
  readonly repo: ArtifactRepository;
  readonly ids: IdFactory;
}

export interface MaterializeSourceInput {
  readonly orgId: OrgId;
  readonly projectId: string | null;
  readonly sourceType: MaterializationSourceType;
  /** The business object id -- `source_ref` (R1). */
  readonly sourceRef: string;
  readonly actorId: string;
  /** D-03a: the only environment-binding field a materialized file may carry. */
  readonly agendaSegmentId?: string | null;
  /**
   * F42/R7 "架构第五节": what the caller itself asked for. For a `generated` artifact this is
   * NOT the final word -- see `sourceConfidentialFlags` below and `strictestConfidential`.
   * Defaults to `false`, same as every pre-F42 caller of `materializeArtifact`.
   */
  readonly confidential?: boolean;
  /**
   * F42: the `confidential` flag of every source material a `generated` artifact was
   * assembled from (e.g. each document a summary read). Ignored for every other
   * `sourceType` -- only `generated` content can "launder" a confidential source into a
   * looser one, because only it produces genuinely new content out of several inputs.
   * `strictestConfidential` ORs these against `confidential` above; no caller-supplied value
   * can loosen the result once any source here is confidential.
   */
  readonly sourceConfidentialFlags?: readonly boolean[];
  /** File name (as named by `SEVEN_SOURCE_FILE_PLAN[sourceType]`) to bytes. */
  readonly parts: Readonly<Record<string, Uint8Array>>;
}

export interface MaterializeSourceResult {
  readonly artifactId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  /** One per file actually written, in plan order -- what V1's "文件名集合" assertion reads. */
  readonly materializedKeys: readonly string[];
  readonly fileNames: readonly string[];
  readonly contentHash: string;
}

export class SourceMaterializationFailedError extends Error {}
export class SourceVersionKeyTakenError extends SourceMaterializationFailedError {}
export class SourceDependencyUnavailableError extends Error {}

/**
 * Materialize one business object's fixed file set as ONE artifact + ONE version.
 *
 * ⚠ One artifact per `(sourceType, sourceRef)` call, unlike F73's `materializeSessionFiles`
 * (one artifact PER FILE, so a transcript can be `derivedFrom` its own audio's version id
 * independently). uc-22-3's model has no such per-file lineage requirement -- R3's table asks
 * for "a file GROUP per business object", which is exactly F04's own `materializeArtifact`
 * shape (survey = responses + schema, ONE version) extended to the two extra domains that
 * shape does not yet cover.
 */
export async function materializeSource(
  deps: MaterializeSourceDeps,
  input: MaterializeSourceInput,
): Promise<MaterializeSourceResult> {
  const { store, repo, ids } = deps;
  const plan = SEVEN_SOURCE_FILE_PLAN[input.sourceType];
  const required = requiredSourceFiles(input.sourceType);

  const missing = required.filter((f) => {
    const b = input.parts[f.name];
    // Zero bytes is a missing file wearing a file's name -- same refusal as F04's own check
    // and F73's own check, for the same reason (I-5).
    return b === undefined || b.byteLength === 0;
  });
  if (missing.length > 0) {
    throw new SourceMaterializationFailedError(
      `source "${input.sourceType}" (${input.sourceRef}) requires ${missing.map((f) => f.name).join(", ")}`,
    );
  }

  const artifactSource = SOURCE_TYPE_ARTIFACT_SOURCE_TAG[input.sourceType];
  const artifactId = ids.next("art");
  // F42: only `generated` content can launder a confidential source into a looser result --
  // every other sourceType materializes its OWN business object's bytes and has no "sources it
  // was assembled from" distinct from itself, so `sourceConfidentialFlags` only applies here.
  const effectiveConfidential =
    input.sourceType === "generated"
      ? strictestConfidential(input.confidential ?? false, (input.sourceConfidentialFlags ?? []).map((c) => ({ confidential: c })))
      : (input.confidential ?? false);
  await repo.createArtifact({
    id: artifactId,
    orgId: input.orgId,
    projectId: input.projectId,
    source: artifactSource,
    title: `${input.sourceType}:${input.sourceRef}`,
    createdBy: input.actorId,
    synthesized: input.sourceType === "generated",
    confidential: effectiveConfidential,
    agendaSegmentId: input.agendaSegmentId,
  });

  const versionNumber = (await repo.headVersionNumber(input.orgId, artifactId)) + 1;
  const versionId = ids.next("ver");

  // Every part the plan names, in plan order, that the caller actually supplied -- required
  // parts are guaranteed present by the check above, optional ones appear when captured.
  const planned: readonly SourceMaterializedFile[] = plan;

  const written: string[] = [];
  const names: string[] = [];
  const hashes: string[] = [];
  let totalBytes = 0;
  let primaryMime = "application/octet-stream";

  for (const file of planned) {
    const bytes = input.parts[file.name];
    if (bytes === undefined || bytes.byteLength === 0) continue;
    const key = storageKey({ orgId: input.orgId, artifactId, versionNumber, fileName: file.name });
    if (written.length === 0) primaryMime = file.mime;

    try {
      await store.putOnce(key, bytes, file.mime);
    } catch (e) {
      if (e instanceof ObjectExistsError) throw new SourceVersionKeyTakenError(e.message);
      if (e instanceof ObjectStoreUnavailableError) throw new SourceDependencyUnavailableError(e.message);
      throw e;
    }

    const back = await store.get(key);
    if (back === null || back.byteLength === 0) {
      throw new SourceMaterializationFailedError(`object ${key} is not readable after write`);
    }
    verifyContentHash(key, computeContentHash(bytes), back);

    written.push(key);
    names.push(file.name);
    hashes.push(computeContentHash(back));
    totalBytes += back.byteLength;
  }

  if (written.length === 0) {
    throw new SourceMaterializationFailedError(`nothing was materialized for ${input.sourceType}:${input.sourceRef}`);
  }

  const contentHash = versionContentHash(hashes);

  await repo.createVersion({
    id: versionId,
    orgId: input.orgId,
    artifactId,
    versionNumber,
    objectStorageKey: written[0]!,
    contentHash,
    mime: primaryMime,
    sizeBytes: totalBytes,
    pinnedBy: input.actorId,
    contextPackId: null,
    // uc-22-3's materializer never derives from another artifact version at the WHOLE-group
    // level (workshop/interview's audio->transcript lineage is F73's own, per-file concern,
    // out of this group-level module's scope).
    derivedFrom: null,
    changeSource: "materialize",
  });

  return {
    artifactId,
    versionId,
    versionNumber,
    materializedKeys: written,
    fileNames: names,
    contentHash,
  };
}
