/**
 * F32 -- 五类预览器 + 单个下载（短时效 · 一次性 · 写审计）。
 *
 * Three use cases: `previewArtifactVersion`, `issueDownloadUrl`, and the redemption that
 * `issueDownloadUrl`'s URL points at.
 *
 * ## Built on F31, and it must not weaken it
 *
 * F31's invariant is 「可见集合 ≡ 检索可见集合」: exactly ONE per-row predicate
 * (`wsx_visible_artifacts()`, migration 0023) and no second filter in TypeScript. These three
 * use cases read through that same predicate -- `findVisibleVersion` joins it -- so a version
 * you cannot see in the browser is a version you cannot preview and cannot download, by
 * construction rather than by a rule someone remembers.
 *
 * ## Why a denial is `ARTIFACT_NOT_FOUND` and never a permission code
 *
 * Look at the signed error lists: `previewArtifactVersion` and `issueDownloadUrl` have
 * **no permission error at all** (`ARTIFACT_NOT_FOUND | INTEGRITY_CHECK_FAILED |
 * DEPENDENCY_UNAVAILABLE`, plus the two redemption codes). That is N-25 already baked into the
 * contract's shape: 「不存在」 and 「不是你的」 must be one answer, or the error code becomes an
 * existence oracle over every artifact id in the organization.
 *
 * ## Where the audit is written, and why it is NOT at issuance
 *
 * The contract says 「下载动作写 provenance_events」. The download ACTION is the redemption --
 * that is the moment bytes leave. A URL that is issued and never clicked is not a download,
 * and recording it as one would corrupt the answer N-19 depends on (「回执须如实说明已出域内容」)
 * in the direction that matters: it would over-report what left the organization, and a
 * deletion receipt that over-reports is one nobody can act on.
 *
 * ⇒ Issuance records nothing. Redemption writes `downloaded`, INSIDE the consuming
 *   transaction (see `DownloadGrantRepository.consume`), so a consumed grant without a trail
 *   is not a state this system can be in.
 *
 * ## 🔴 What is NOT implemented here, stated rather than left to be discovered
 *
 * `INTEGRITY_CHECK_FAILED` is in both operations' `err` lists and is **not raised anywhere in
 * this file**. Raising it truthfully means reading the object's bytes and comparing SHA-256
 * against `artifact_versions.content_hash` on every preview and every issuance -- that is
 * F42's 完整性校验 and it needs an object store that can stream. There is no partial version of
 * it worth having: a check that only ran when the store happened to be fast would make
 * 「校验过了」 unanswerable. So the code is declared by the contract and unreachable in this
 * implementation, and that is reported, not hidden behind a `catch`.
 */
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import {
  decidePreview,
  type PreviewDecision,
} from "../../domain/files/preview-kind";
import { downloadExpiry, mintDownloadToken } from "../../domain/files/download-grant";
import { originalDownloadable } from "../../domain/files/ingestion-visibility";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import type { IdFactory } from "../artifact/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import { discloseDecided, isDisclosed, type Disclosed } from "../security/permission-filter";
import type { ObjectStoreProbe } from "./ports";
import type {
  ConsumedDownloadGrant,
  DeliverableVersion,
  DownloadGrantRepository,
  DownloadUrlBuilder,
  RedeemFailure,
} from "./download-ports";

export type PreviewResult = z.infer<typeof C.operations.previewArtifactVersion.out>;
export type IssueDownloadUrlResult = z.infer<typeof C.operations.issueDownloadUrl.out>;

/** One of `files.FilesError`; `interface` maps it to a status. This layer knows no HTTP. */
export type DeliveryReasonCode =
  | "ARTIFACT_NOT_FOUND"
  | "DEPENDENCY_UNAVAILABLE"
  | "DOWNLOAD_URL_EXPIRED"
  | "DOWNLOAD_URL_CONSUMED";

export class FilesDeliveryError extends Error {
  constructor(readonly reasonCode: DeliveryReasonCode) {
    super("files_delivery_failed");
  }
}

export interface DeliveryDeps extends AuthorizeDeps {
  readonly grants: DownloadGrantRepository;
  readonly objectStore: ObjectStoreProbe;
  readonly urls: DownloadUrlBuilder;
  readonly provenance: ProvenanceWriter;
  /**
   * Grant row ids. Separate from `AuthorizeDeps["ids"]` (which mints permission-DECISION ids)
   * on purpose: one is an audit key that must trace back to `authorize`, the other is a
   * primary key. Sharing a factory is how a decision id ends up looking like a row id in the
   * trail and neither can be searched for reliably.
   */
  readonly idFactory: IdFactory;
  /** Injected so the TTL boundary is testable without sleeping for two minutes. */
  readonly now: () => Date;
}

export interface DeliveryInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly versionId: string;
}

/**
 * The action delivery is judged as -- the SAME one the browser uses (`browse-artifacts.ts`).
 *
 * Deliberately not a looser surface such as `read.published`: an observer holds only that, and
 * choosing it here would hand observers a download path while nothing in the role matrix said
 * so. ⚠ Whether an observer SHOULD be able to download is `files.KNOWN_CONTRACT_GAPS.FS3`
 * (T-6, unruled) -- the prototype kept the download button's structure with one un-wired gate,
 * so the UI reads as decided when it is not. This takes the fail-closed branch. It is not a
 * ruling and it is the single line to change when T-6 lands.
 */
const DELIVER_ACTION = "read.allHands";

/**
 * Resolve the version and run the requester gate.
 *
 * Order matters and is the opposite of the obvious one: the ROW gate (SQL) runs first, because
 * the caller only supplies a `versionId` and the project the requester must be authorized
 * against is a property of the row. The row arrives `Guarded`, so nothing is disclosed before
 * `authorize` has produced a decision.
 */
async function resolveVisible(
  deps: DeliveryDeps,
  input: DeliveryInput,
): Promise<{ version: DeliverableVersion; decision: PermissionDecision }> {
  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  const found = await deps.grants.findVisibleVersion({
    orgId: input.orgId,
    versionId: input.versionId,
    requesterTeamId: membership?.teamId ?? null,
  });
  // Not visible, or not there. One answer, on purpose -- see the header.
  if (!found) throw new FilesDeliveryError("ARTIFACT_NOT_FOUND");

  const decision = await authorize(deps, {
    userId: input.userId,
    orgId: input.orgId,
    // `?? undefined`: an unbound artifact has no project layer to intersect with, which
    // `authorize` expresses by the field being ABSENT, not by a null project id.
    projectId: found.projectId ?? undefined,
    object: { kind: "artifact", id: found.artifactId },
    action: DELIVER_ACTION,
  });
  const disclosed = discloseDecided(found.version, decision);
  if (!isDisclosed(disclosed)) throw new FilesDeliveryError("ARTIFACT_NOT_FOUND");
  return { version: (disclosed as Disclosed<DeliverableVersion>).payload, decision };
}

export async function previewArtifactVersion(
  deps: DeliveryDeps,
  input: DeliveryInput,
): Promise<PreviewResult> {
  const { version } = await resolveVisible(deps, input);
  const decided: PreviewDecision = decidePreview(version.mime);

  return {
    kind: decided.kind,
    renderMode: decided.renderMode,
    meta: { mime: version.mime, sizeBytes: version.sizeBytes },
    anchorSupport: decided.anchorSupport,
    /**
     * E5·22-1: 「派生物未就绪时标『生成中』，并如实说明检索侧尚未可召回」.
     *
     * Derived from the ingestion state machine, not from a separate flag: `originalDownloadable`
     * is true from `STORED` onward, and everything before `READY`/`INDEXED` still has derived
     * work outstanding. Using the ONE table in `ingestion-visibility.ts` rather than a second
     * list here is the same discipline F31 applied to `retrievable`.
     */
    derivedGenerating:
      originalDownloadable(version.ingestionStatus) && version.ingestionStatus !== "READY" &&
      version.ingestionStatus !== "INDEXED",
  };
}

export async function issueDownloadUrl(
  deps: DeliveryDeps,
  input: DeliveryInput & { readonly purpose: "download" | "export" },
): Promise<IssueDownloadUrlResult> {
  const { version, decision } = await resolveVisible(deps, input);

  /**
   * 「pre: 对象存储可用」 (usecases.md, verbatim).
   *
   * Checked BEFORE minting, so a store outage produces `DEPENDENCY_UNAVAILABLE` rather than a
   * link that 404s two minutes from now -- V7·22-1's whole point is that a degraded download
   * says so instead of behaving like a broken one.
   */
  if (!(await deps.objectStore.available())) throw new FilesDeliveryError("DEPENDENCY_UNAVAILABLE");

  const token = mintDownloadToken();
  const now = deps.now();
  const expiresAt = downloadExpiry(now);

  await deps.grants.issue({
    id: deps.idFactory.next("dlg"),
    orgId: input.orgId,
    artifactId: version.artifactId,
    versionId: version.versionId,
    objectKey: version.objectKey,
    // 🔴 The link is bound to the person it was issued to. Short-lived + one-time alone would
    // still let a FORWARDED link work for whoever clicks first, which is exactly the
    // 「可转发」 N-24 forbids.
    principalUserId: input.userId,
    permissionDecisionId: decision.decisionId,
    purpose: input.purpose,
    // Only the hash is persisted. The raw token exists in this function and in the response.
    tokenHash: token.hash,
    expiresAt,
  });

  return {
    url: deps.urls.build(token.raw),
    expiresAt: expiresAt.toISOString(),
    permissionDecisionId: decision.decisionId,
    // `z.literal(true)`: the contract has no value for a reusable link, so neither does this.
    oneTime: true,
  };
}

/** What the redemption route needs in order to stream the bytes. */
export interface RedeemedDownload {
  readonly objectKey: string;
  readonly artifactId: string;
  readonly versionId: string;
  readonly provenanceEventId: string;
}

const FAILURE_CODE: Readonly<Record<RedeemFailure, DeliveryReasonCode>> = {
  expired: "DOWNLOAD_URL_EXPIRED",
  consumed: "DOWNLOAD_URL_CONSUMED",
  // A token that never existed, a token for another tenant, and a token issued to somebody
  // else are one answer. Distinguishing them would tell a holder of a forwarded link that the
  // link is real and merely not theirs.
  "not-found": "ARTIFACT_NOT_FOUND",
};

/**
 * Redeem a download URL: consume it and write the audit, atomically.
 *
 * The one-time condition is decided by the repository's single UPDATE (see
 * `DownloadGrantRepository.consume`). This function does not pre-check anything -- there is no
 * `if (grant.consumedAt)` here, and there must never be one, because a pre-check in front of
 * the update is exactly the concurrency hole F15 found: two callers both pass it, both update,
 * both download, nothing errors.
 */
export async function redeemDownloadUrl(
  deps: DeliveryDeps,
  input: { readonly userId: string; readonly orgId: OrgId; readonly tokenHash: string },
): Promise<RedeemedDownload> {
  let eventId = "";

  const result = await deps.grants.consume(
    { orgId: input.orgId, tokenHash: input.tokenHash, principalUserId: input.userId },
    async (session, grant: ConsumedDownloadGrant) => {
      // Inside the consuming transaction. If this throws, the consumption rolls back and the
      // link is still good -- a download with no trail is not a state this system can reach.
      eventId = await deps.provenance.appendWithin(session, {
        orgId: input.orgId,
        type: "downloaded",
        actorId: input.userId,
        target: { kind: "artifact-version", id: grant.versionId },
        detail: {
          artifactId: grant.artifactId,
          purpose: grant.purpose,
          // 「为什么给你下」, recoverable afterwards: the decision that authorised the issuance.
          permissionDecisionId: grant.permissionDecisionId,
          grantId: grant.id,
        },
      });
    },
  );

  if ("failure" in result) throw new FilesDeliveryError(FAILURE_CODE[result.failure]);
  return {
    objectKey: result.grant.objectKey,
    artifactId: result.grant.artifactId,
    versionId: result.grant.versionId,
    provenanceEventId: eventId,
  };
}
