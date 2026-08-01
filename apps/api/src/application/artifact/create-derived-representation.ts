/**
 * `createDerivedRepresentation` -- one OCR/ASR/summary/visual-description/embedding output,
 * recorded and (except embedding) materialized as an independent downloadable file
 * (uc-22-4 R3.b steps 4-5, contract's `listDerived`/`rerunDerivation`).
 *
 * ## Why this never overwrites anything (V3, R7 🔴)
 *
 * This function has no UPDATE anywhere in it -- rerunning OCR calls it again with a new
 * `generatorVersion`/`pipelineVersion` and gets back a SECOND row, because:
 *
 *   1. the object key is derived from `derivedStorageKey()`, which is namespaced under
 *      `<org>/derived/<artifactVersionId>/<kind>/...` -- a DIFFERENT prefix from
 *      `storageKey()` (the original's), so a derivative can never land on an original's key
 *      even by accident (I-6);
 *   2. `ArtifactRepository.createDerived` is INSERT-only (see that method's own comment);
 *   3. `derived_key_not_an_original_trg` (0006) is the database's own refusal if either of
 *      the above were ever bypassed.
 *
 * So "the original's `content_hash` is unchanged after a rerun" is not something this
 * function has to prove -- it never touches `artifact_versions` at all. What IS this
 * function's job is (5): every derivative names the exact `artifactVersionId` it came from
 * (never an `artifactId`, N-15) and carries a NON-empty generator identity, because a
 * derivative with no recorded model/version is unverifiable evidence wearing a citation's
 * shape.
 *
 * ## `embedding` is the one kind that is registered but not materialized (R3.b step 4)
 *
 * Every other kind gets a real object written and its key stored. `embedding` skips the
 * object-store write entirely -- it lives in pgvector, this table only records that the row
 * exists and what produced it. `objectStorageKey` is `null` on that row, enforced by the
 * migration's `derived_representations_materialized_unless_embedding` CHECK.
 */
import { derivedStorageKey } from "../../domain/artifact/materialization";
import type { OrgId } from "../../domain/org-id";
import {
  DependencyUnavailableError,
  MaterializationFailedError,
} from "./materialize-artifact";
import {
  ObjectStoreUnavailableError,
  type ArtifactRepository,
  type DerivedKind,
  type IdFactory,
  type ObjectStore,
} from "./ports";

export interface CreateDerivedDeps {
  readonly store: ObjectStore;
  readonly repo: ArtifactRepository;
  readonly ids: IdFactory;
}

export interface CreateDerivedInput {
  readonly orgId: OrgId;
  /** The exact `artifact_versions.id` this is derived FROM. Never an artifact id (N-15). */
  readonly artifactVersionId: string;
  readonly kind: DerivedKind;
  /** Relative name under the derived storage prefix, e.g. `text.ocr.txt`. Ignored for embedding. */
  readonly fileName: string;
  /** The derived file's bytes. Required for every kind except `embedding`. */
  readonly bytes?: Uint8Array;
  /** Non-empty by construction (R3.b step 5) -- see the `assertNonEmpty` calls below. */
  readonly generatorModel: string;
  readonly generatorVersion: string;
  readonly pipelineVersion: string;
}

export interface CreateDerivedResult {
  readonly derivedId: string;
  readonly objectStorageKey: string | null;
}

function assertNonEmpty(label: string, value: string): void {
  if (value.trim().length === 0) {
    throw new MaterializationFailedError(`derived representation requires a non-empty ${label}`);
  }
}

const MIME_FOR_KIND: Record<Exclude<DerivedKind, "embedding">, string> = {
  ocr: "text/plain",
  asr: "application/jsonl",
  summary: "text/markdown",
  "visual-description": "text/plain",
};

export async function createDerivedRepresentation(
  deps: CreateDerivedDeps,
  input: CreateDerivedInput,
): Promise<CreateDerivedResult> {
  // R3.b step 5: every derivative records what generated it. Checked before anything is
  // written -- an ungenerated-by-anything derivative is not a derivative, it is an
  // unattributed file that happens to sit under a version.
  assertNonEmpty("generatorModel", input.generatorModel);
  assertNonEmpty("generatorVersion", input.generatorVersion);
  assertNonEmpty("pipelineVersion", input.pipelineVersion);

  const derivedId = deps.ids.next("drv");

  if (input.kind === "embedding") {
    await deps.repo.createDerived({
      id: derivedId,
      orgId: input.orgId,
      derivedFrom: input.artifactVersionId,
      kind: input.kind,
      objectStorageKey: null,
      generatorModel: input.generatorModel,
      generatorVersion: input.generatorVersion,
      pipelineVersion: input.pipelineVersion,
    });
    return { derivedId, objectStorageKey: null };
  }

  if (input.bytes === undefined || input.bytes.byteLength === 0) {
    // I-5's shadow on the derived side: a "file" with nothing behind it is not one (R3.b
    // step 4 -- every non-embedding kind MUST be a real downloadable file).
    throw new MaterializationFailedError(`derived kind "${input.kind}" requires a materialized file`);
  }

  // The derived id is folded into the key, not just `fileName`: A4 requires a rerun to
  // PRESERVE the old derived version, and `fileName` alone repeats across reruns of the same
  // kind on the same version (an OCR rerun still produces "text.ocr.txt"). Without a
  // per-generation discriminator, the second `putOnce` for the same (version, kind, fileName)
  // would hit the SAME key as the first -- write-once refuses it outright, which would make
  // "rerun" fail instead of silently overwrite (the safe failure direction), but still not the
  // "old version stays downloadable" outcome A4 actually asks for.
  const key = derivedStorageKey({
    orgId: input.orgId,
    artifactVersionId: input.artifactVersionId,
    kind: input.kind,
    fileName: `${derivedId}/${input.fileName}`,
  });

  try {
    await deps.store.putOnce(key, input.bytes, MIME_FOR_KIND[input.kind]);
  } catch (e) {
    if (e instanceof ObjectStoreUnavailableError) throw new DependencyUnavailableError(e.message);
    throw e;
  }

  // Read back, same discipline `materializeArtifact` uses for originals (I-3): the row
  // asserts a hash-worthy fact about the object store, so it should be recorded from bytes
  // the store actually has, not from bytes still only in memory. Unlike originals, derived
  // rows carry no `content_hash` column (contract has none for `listDerived.out`), so there
  // is nothing to verify the read-back AGAINST here -- the read-back itself is still the
  // proof the object is retrievable before the row claims it is.
  const back = await deps.store.get(key);
  if (back === null || back.byteLength === 0) {
    throw new MaterializationFailedError(`derived object ${key} is not readable after write`);
  }

  await deps.repo.createDerived({
    id: derivedId,
    orgId: input.orgId,
    derivedFrom: input.artifactVersionId,
    kind: input.kind,
    objectStorageKey: key,
    generatorModel: input.generatorModel,
    generatorVersion: input.generatorVersion,
    pipelineVersion: input.pipelineVersion,
  });

  return { derivedId, objectStorageKey: key };
}
