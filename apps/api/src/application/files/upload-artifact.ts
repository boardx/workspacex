/**
 * F35 -- upload interface: server-side re-validation, three security checks, object-storage
 * write (uc-22-2 R3 steps 1-6, R7, E1-E3, E7, V1[partial]/V4/V5/V6/V8[partial]).
 *
 * ## Scope, precisely
 *
 * This use case covers everything UP TO `STORED` (uc-22-2 R3 steps 1-6): server-side
 * validation redo, the three security checks, and the write-once object-storage commit with
 * no ghost version. `EXTRACTED`/`SEGMENTED`/`ENRICHED`/`INDEXED`/`REVIEW_PENDING`/`READY` --
 * the rest of the nine-state pipeline, the outbox/worker, and idempotent dedup -- are F36
 * and F37, not here. A file this use case accepts is `STORED`: visible and downloadable in
 * the browser (uc-22-1), not yet searchable.
 *
 * ## Why this reuses `materializeArtifact` rather than writing its own store/repo dance
 *
 * The "no ghost version" property (V11 / this feature's `no-orphan-version` test) is
 * exactly what F04's `materializeArtifact` already proves: object storage first, hash
 * verified against a read-back, PostgreSQL row last, `DependencyUnavailableError` surfaced
 * distinctly when the store itself is unreachable. Re-implementing that ordering here would
 * be a second copy of the one thing this repository has been burned by repeatedly
 * (duplicated invariants drifting apart) -- so this use case's OWN job is only what precedes
 * that call: revalidate, scan, sniff, bomb-check. `source: "upload"` already has a
 * `MATERIALIZATION_PLAN` entry (`{ name: "original", mime: "application/octet-stream" }"),
 * added by F04 for exactly this shape.
 *
 * ## Per-file, not all-or-nothing
 *
 * uc-22-2 R3 step 1 requires the front-end precheck to "逐个列出不通过原因" (list failure
 * reasons file by file); the server redo (R7: "服务端必须完整重做全部校验") preserves that
 * granularity rather than failing the whole request on one bad file. The exception is the
 * BATCH total-size cap, which is a property of the whole request and is checked before any
 * file is touched.
 */
import { computeContentHash, versionContentHash, type ContentHash } from "../../domain/artifact/content-hash";
import {
  EXTENSION_WHITELIST,
  UPLOAD_LIMITS,
  extensionOf,
  validateBatchLimits,
  validateFileLimits,
} from "../../domain/files/upload-limits";
import { scanForMalware } from "../../domain/files/malware-scan";
import { sniffAndCheck, type SniffedKind } from "../../domain/files/mime-sniff";
import { inspectZipForBomb, looksLikeZip, type ZipBombReason } from "../../domain/files/zip-inspect";
import {
  CURRENT_PARSER_VERSION,
  CURRENT_PIPELINE_VERSION,
} from "../../domain/files/idempotency-key";
import {
  DependencyUnavailableError,
  materializeArtifact,
} from "../artifact/materialize-artifact";
import type { ArtifactRepository, IdFactory, ObjectStore } from "../artifact/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import type { QuarantineRepository, SecurityAlertPort } from "./upload-ports";
import type { OrgId } from "../../domain/org-id";

export interface UploadFileInput {
  readonly filename: string;
  readonly bytes: Uint8Array;
}

export interface UploadArtifactInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  /** null = 入口二（文件页/拖拽），落「未归入环节」节点. Entry one binds the row's segment. */
  readonly agendaSegmentId: string | null;
  readonly confidential: boolean;
  readonly actorId: string;
  readonly files: readonly UploadFileInput[];
  /**
   * F37 -- the third component of the idempotency key (uc-22-2 R7: "parser_version 升版后再
   * 上传新增派生版本而旧 Segment 未被修改"). Undefined means "current parser", i.e. every
   * caller before F37 (and every caller that never re-parses) gets the one value that was
   * ever true for them (`CURRENT_PARSER_VERSION`).
   */
  readonly parserVersion?: string;
}

export interface UploadArtifactDeps {
  readonly store: ObjectStore;
  readonly repo: ArtifactRepository;
  readonly ids: IdFactory;
  readonly quarantine: QuarantineRepository;
  readonly alerts: SecurityAlertPort;
  /**
   * F37 -- records the `ingested` provenance event on every accepted file, duplicate or not
   * (see `processOneFile`). Optional so every pre-F37 caller of this deps shape keeps
   * compiling unchanged; a caller that omits it simply gets no audit trail for the upload,
   * which is the same "undefined = no-op" shape `ReviewGate`/`NEVER_NEEDS_REVIEW` already
   * established in `ingestion-worker.ts` for an unwired port.
   */
  readonly provenance?: ProvenanceWriter;
}

export type RejectionReason =
  | { readonly kind: "FILE_TYPE_REJECTED"; readonly extension: string }
  | { readonly kind: "FILE_TOO_LARGE"; readonly actualBytes: number; readonly limitBytes: number }
  | { readonly kind: "MALWARE_DETECTED"; readonly verdict: string }
  | { readonly kind: "MIME_MISMATCH"; readonly detected: SniffedKind; readonly declaredExtension: string }
  | { readonly kind: "ARCHIVE_BOMB_DETECTED"; readonly reason: ZipBombReason }
  | { readonly kind: "DEPENDENCY_UNAVAILABLE"; readonly detail: string };

export interface AcceptedUpload {
  readonly filename: string;
  readonly status: "accepted";
  readonly artifactId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly contentHash: ContentHash;
  /**
   * F37 -- `true` iff this exact content_hash+pipeline_version+parser_version already had a
   * version in this project: NO new `artifact_versions` row was written, `versionId`/
   * `versionNumber` name the EXISTING one, and the only new row anywhere is one
   * `provenance_events` entry. Never silent (uc-22-2 R7 🔴 "幂等命中不得静默") -- this is the
   * field a caller surfaces as the duplicate-hit choice (contract's `uploadArtifact.out`
   * `duplicateHit`, the UI half of which is T78 / out of this feature's scope).
   */
  readonly duplicate: boolean;
}

export interface RejectedUpload {
  readonly filename: string;
  readonly status: "rejected";
  readonly reason: RejectionReason;
}

export type UploadOutcome = AcceptedUpload | RejectedUpload;

export interface UploadArtifactResult {
  readonly files: readonly UploadOutcome[];
}

/** The whole-request cap was exceeded -- checked before any file is processed (E1). */
export class BatchLimitExceededError extends Error {
  constructor(readonly actualBytes: number, readonly limitBytes: number) {
    super(`upload batch of ${actualBytes} bytes exceeds the ${limitBytes}-byte cap`);
  }
}

export async function uploadArtifact(
  deps: UploadArtifactDeps,
  input: UploadArtifactInput,
): Promise<UploadArtifactResult> {
  const totalBytes = input.files.reduce((sum, f) => sum + f.bytes.byteLength, 0);
  const batchViolation = validateBatchLimits(totalBytes);
  if (batchViolation !== null) {
    throw new BatchLimitExceededError(batchViolation.actualBytes, batchViolation.limitBytes);
  }

  const outcomes: UploadOutcome[] = [];
  for (const file of input.files) {
    outcomes.push(await processOneFile(deps, input, file));
  }
  return { files: outcomes };
}

function rejected(filename: string, reason: RejectionReason): RejectedUpload {
  return { filename, status: "rejected", reason };
}

async function processOneFile(
  deps: UploadArtifactDeps,
  input: UploadArtifactInput,
  file: UploadFileInput,
): Promise<UploadOutcome> {
  // ── 1. server-side redo of the precheck (extension whitelist + per-file size cap) ──────
  const limitViolation = validateFileLimits(file.filename, file.bytes.byteLength);
  if (limitViolation !== null) {
    return rejected(
      file.filename,
      limitViolation.kind === "FILE_TYPE_REJECTED"
        ? { kind: "FILE_TYPE_REJECTED", extension: limitViolation.extension }
        : { kind: "FILE_TOO_LARGE", actualBytes: limitViolation.actualBytes, limitBytes: limitViolation.limitBytes },
    );
  }

  const contentHash = computeContentHash(file.bytes);

  // ── 2. malware scan (E2) ────────────────────────────────────────────────────────────────
  const scan = scanForMalware(file.bytes);
  if (!scan.clean) {
    let alerted = true;
    try {
      await deps.alerts.raise({
        orgId: input.orgId,
        kind: "malware-detected",
        filename: file.filename,
        contentHash,
        detail: scan.conclusion,
      });
    } catch {
      // The quarantine record must exist even if paging failed -- "caught but nobody was
      // told" is a distinguishable, queryable state (`alerted = false`), not a lost event.
      alerted = false;
    }
    await deps.quarantine.record({
      orgId: input.orgId,
      projectId: input.projectId,
      filename: file.filename,
      contentHash,
      scanVerdict: scan.conclusion,
      uploadedBy: input.actorId,
      alerted,
    });
    return rejected(file.filename, { kind: "MALWARE_DETECTED", verdict: scan.conclusion });
  }

  // ── 3. MIME sniff by actual bytes, extension/Content-Type both untrusted (V6) ──────────
  const ext = extensionOf(file.filename);
  const expected = EXTENSION_WHITELIST.get(ext);
  const sniff = sniffAndCheck(file.filename, file.bytes, expected);
  if (sniff.mismatch) {
    return rejected(file.filename, { kind: "MIME_MISMATCH", detected: sniff.detected, declaredExtension: ext });
  }

  // ── 4. archive/zip-bomb limits (V5) -- only for files that are genuinely zip-shaped ─────
  // (a zip renamed to look like something else already failed step 3 above; this only
  // triggers for files whose declared AND sniffed type both agree they are a zip container).
  if (looksLikeZip(file.bytes)) {
    const inspection = await inspectZipForBomb(file.bytes, {
      maxEntries: UPLOAD_LIMITS.maxZipEntries,
      maxDecompressedBytes: UPLOAD_LIMITS.maxDecompressedBytes,
      maxNestingDepth: UPLOAD_LIMITS.maxZipNestingDepth,
    });
    if (!inspection.ok) {
      // A malformed archive still counts as a bomb rejection here: there is no numeric
      // limit to report for it, but "reject before/at SCANNED, never store it" is the same
      // outcome E1 asks for either way.
      return rejected(file.filename, {
        kind: "ARCHIVE_BOMB_DETECTED",
        reason: inspection.reason ?? { kind: "malformed-archive" },
      });
    }
  }

  // ── 5. idempotency check (F37, uc-22-2 R7) -- BEFORE materializing, never after ─────────
  // "重复上传不产生重复 Segment" holds by construction once this returns a hit: no new
  // `artifact_versions` row is written, so no new EXTRACTED/SEGMENTED job is ever enqueued
  // for it, so no new Segment can be produced for this upload. Validation (steps 1-4) still
  // ran in full either way (R7 🔴 "服务端必须完整重做全部校验") -- a duplicate file is not
  // exempt from the security checks just because its bytes were seen before.
  const parserVersion = input.parserVersion ?? CURRENT_PARSER_VERSION;
  // `materializeArtifact` records `versionContentHash([<per-file hash>, ...])` as the
  // version's `content_hash` -- NEVER the bare `computeContentHash` of one file's bytes (see
  // that function's own comment: a version can be several files, so "the hash of the file"
  // has no single referent). `upload-new-version.ts` (F44) already established the fix for
  // comparing a fresh upload against an existing version's hash without re-materializing:
  // apply the SAME formula here, or every dedup lookup misses by construction (a duplicate
  // upload would never match the version its first upload actually wrote).
  const versionKey = versionContentHash([contentHash]);
  const duplicate = await deps.repo.findVersionByIdempotencyKey(
    input.orgId,
    input.projectId,
    versionKey,
    CURRENT_PIPELINE_VERSION,
    parserVersion,
  );
  if (duplicate !== null) {
    // uc-22-2 R7 🔴 "幂等命中不得静默": a new `provenance_events` row records THAT this
    // upload happened, even though no new version did -- the difference between "nothing
    // happened" and "a duplicate was recognised and not re-stored" has to be visible in the
    // trail, not just in this call's return value.
    await deps.provenance?.append({
      orgId: input.orgId,
      type: "ingested",
      actorId: input.actorId,
      target: { kind: "artifact", id: duplicate.artifactId },
      detail: {
        duplicate: true,
        filename: file.filename,
        contentHash,
        pipelineVersion: CURRENT_PIPELINE_VERSION,
        parserVersion,
        versionId: duplicate.versionId,
        versionNumber: duplicate.versionNumber,
      },
    });
    return {
      filename: file.filename,
      status: "accepted",
      artifactId: duplicate.artifactId,
      versionId: duplicate.versionId,
      versionNumber: duplicate.versionNumber,
      contentHash,
      duplicate: true,
    };
  }

  // ── 6. object storage write + artifact_version, no-ghost-version guaranteed by F04 ──────
  try {
    const result = await materializeArtifact(
      { store: deps.store, repo: deps.repo, ids: deps.ids },
      {
        orgId: input.orgId,
        projectId: input.projectId,
        source: "upload",
        title: file.filename,
        actorId: input.actorId,
        parts: { original: file.bytes },
        agendaSegmentId: input.agendaSegmentId,
        confidential: input.confidential,
        // STORED, not READY: F36 owns the rest of the nine-state pipeline. See file header.
        ingestionStatus: "STORED",
        pipelineVersion: CURRENT_PIPELINE_VERSION,
        parserVersion,
      },
    );
    await deps.provenance?.append({
      orgId: input.orgId,
      type: "ingested",
      actorId: input.actorId,
      target: { kind: "artifact", id: result.artifactId },
      detail: {
        duplicate: false,
        filename: file.filename,
        contentHash: result.contentHash,
        pipelineVersion: CURRENT_PIPELINE_VERSION,
        parserVersion,
        versionId: result.versionId,
        versionNumber: result.versionNumber,
      },
    });
    return {
      filename: file.filename,
      status: "accepted",
      artifactId: result.artifactId,
      versionId: result.versionId,
      versionNumber: result.versionNumber,
      contentHash: result.contentHash,
      duplicate: false,
    };
  } catch (e) {
    if (e instanceof DependencyUnavailableError) {
      return rejected(file.filename, { kind: "DEPENDENCY_UNAVAILABLE", detail: e.message });
    }
    // MaterializationFailedError / VersionKeyTakenError describe programmer-facing
    // conditions (e.g. a reused version number) that do not correspond to any member of
    // this feature's rejection vocabulary -- surfaced as a hard failure rather than folded
    // into a user-facing reason that would misdescribe them.
    throw e;
  }
}
