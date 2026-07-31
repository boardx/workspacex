/**
 * F32's three delivery routes. Protocol adaptation only -- every judgement is in `application`.
 *
 *   GET  /artifact-versions/:versionId/preview       contract `previewArtifactVersion`
 *   POST /artifact-versions/:versionId/download-url  contract `issueDownloadUrl`
 *   GET  /downloads/:token                           **not in the contract** -- see below
 *
 * ## ⚠ The redemption route has no contract operation, and that is a contract gap
 *
 * `issueDownloadUrl.err` declares `DOWNLOAD_URL_EXPIRED` and `DOWNLOAD_URL_CONSUMED`. Neither
 * can ever arise while ISSUING a link -- a link that has just been minted is neither expired
 * nor consumed. They can only arise when one is REDEEMED, and the contract has no operation
 * for redemption: `out.url` is a bare string with no route behind it.
 *
 * ⇒ So the URL has to point somewhere, and this is that somewhere. It is reported rather than
 *   quietly regularised: the signed contract should either grow a `redeemDownloadUrl`
 *   operation or move those two codes onto it. Until then the two error codes are declared on
 *   an operation that cannot raise them, and this route is the only place they are real.
 *
 * ## Denials are a BARE 404, byte-identical to a missing artifact
 *
 * `files.FilesError.ARTIFACT_NOT_FOUND` carries an explicit tightening in the contract:
 * 「与『真的不存在』**逐字节同响应**（状态码 + 响应体 + 响应头，N-25 / V6·22-1）。任何差异都
 * 是资源存在性泄露」. So this controller throws `NotFoundException()` with NO body and NO
 * `reasonCode` for every not-visible / not-yours / not-there case -- the same treatment
 * `interview-scope.controller.ts` gives `NO_INTERVIEW_ACCESS`, and for the same reason. A
 * later "helpful" change that attaches a reasonCode here reopens an existence oracle over
 * every artifact id in the organization.
 *
 * ⚠ The contract also names response TIME as part of that identity. This code does not
 *   equalise timing (a visible version does one more query than an invisible one), and no
 *   test here asserts it. The contract itself says 「那一条契约表达不了，只能在验收里测」;
 *   it is unmet, and saying so is better than a comment implying otherwise.
 */
import {
  Controller, Get, Inject, NotFoundException, Param, Post, Query, ServiceUnavailableException,
  ConflictException, GoneException, UnprocessableEntityException,
} from "@nestjs/common";
import { files as C } from "@repo/contracts";
import {
  FilesDeliveryError,
  issueDownloadUrl,
  previewArtifactVersion,
  redeemDownloadUrl,
  type DeliveryDeps,
  type IssueDownloadUrlResult,
  type PreviewResult,
} from "../../application/files/deliver-artifact";
import {
  DOWNLOAD_GRANT_REPOSITORY,
  DOWNLOAD_URL_BUILDER,
  type DownloadGrantRepository,
  type DownloadUrlBuilder,
} from "../../application/files/download-ports";
import {
  OBJECT_INTEGRITY_CHECKER, OBJECT_STORE_PROBE,
  type ObjectIntegrityChecker, type ObjectStoreProbe,
} from "../../application/files/ports";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import { ID_FACTORY, type IdFactory } from "../../application/artifact/ports";
import { PROVENANCE_WRITER, type ProvenanceWriter } from "../../application/provenance/ports";
import { hashDownloadToken } from "../../domain/files/download-grant";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

export const PREVIEW_SCHEMA = C.operations.previewArtifactVersion.in;
export const ISSUE_DOWNLOAD_SCHEMA = C.operations.issueDownloadUrl.in;

/** What the redemption route returns. Bytes are the object store's job, not this route's. */
export interface RedeemResponse {
  readonly objectKey: string;
  readonly artifactId: string;
  readonly versionId: string;
  readonly provenanceEventId: string;
  /**
   * 🔴 Always `attachment`, for every type, not only unknown ones.
   *
   * The contract's rule is 「未知类型一律 attachment + 隔离域名」. This route serves from the
   * isolated origin only and never inlines, so the stronger blanket rule costs nothing and
   * removes the branch where a MIME sniff decides whether a file gets to run.
   */
  readonly contentDisposition: "attachment";
}

@Controller()
export class FilesDeliveryController {
  constructor(
    @Inject(DOWNLOAD_GRANT_REPOSITORY) private readonly grants: DownloadGrantRepository,
    @Inject(DOWNLOAD_URL_BUILDER) private readonly urls: DownloadUrlBuilder,
    @Inject(OBJECT_STORE_PROBE) private readonly objectStore: ObjectStoreProbe,
    @Inject(OBJECT_INTEGRITY_CHECKER) private readonly integrity: ObjectIntegrityChecker,
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(ID_FACTORY) private readonly idFactory: IdFactory,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
  ) {}

  private get deps(): DeliveryDeps {
    return {
      repo: this.repo,
      ids: this.ids,
      grants: this.grants,
      objectStore: this.objectStore,
      integrity: this.integrity,
      urls: this.urls,
      provenance: this.provenance,
      idFactory: this.idFactory,
      now: () => new Date(),
    };
  }

  @Get("/artifact-versions/:versionId/preview")
  async preview(
    @CurrentPrincipal() principal: Principal,
    @Param("versionId") versionId: string,
  ): Promise<PreviewResult> {
    assertPrincipal(principal);
    const input = PREVIEW_SCHEMA.parse({ versionId });
    return this.mapErrors(() =>
      previewArtifactVersion(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        versionId: input.versionId,
      }),
    );
  }

  @Post("/artifact-versions/:versionId/download-url")
  async issue(
    @CurrentPrincipal() principal: Principal,
    @Param("versionId") versionId: string,
    @Query("purpose") purpose: string | undefined,
  ): Promise<IssueDownloadUrlResult> {
    assertPrincipal(principal);
    // `download` is the default: the export path passes `purpose=export` explicitly, and a
    // missing value defaulting to the broader one would let an export be recorded as an
    // ordinary download in the audit trail.
    const input = ISSUE_DOWNLOAD_SCHEMA.parse({ versionId, purpose: purpose ?? "download" });
    return this.mapErrors(() =>
      issueDownloadUrl(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        versionId: input.versionId,
        purpose: input.purpose,
      }),
    );
  }

  /**
   * Redeem. Authenticated, because the grant is bound to a principal.
   *
   * ⚠ The RAW token never reaches the application layer -- it is hashed here and only the
   * hash travels inward. Same treatment as a session token: the fewer frames a bearer
   * credential passes through in plaintext, the fewer places it can end up in a log.
   */
  @Get("/downloads/:token")
  async redeem(
    @CurrentPrincipal() principal: Principal,
    @Param("token") token: string,
  ): Promise<RedeemResponse> {
    assertPrincipal(principal);
    const result = await this.mapErrors(() =>
      redeemDownloadUrl(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        tokenHash: hashDownloadToken(token),
      }),
    );
    return { ...result, contentDisposition: "attachment" };
  }

  /**
   * The reason travels in the body only where it is safe to; `ARTIFACT_NOT_FOUND` is bare.
   *
   * 410 for expired and 409 for consumed: both are gone, but for different reasons and with
   * different next steps (「重新点下载」 versus 「这条链接已经被用掉了，是你用的吗」), and the
   * `reasonCode` in the body is what the UI renders. `files.FilesError` is a closed enum in
   * `@repo/contracts` and `AllExceptionsFilter` parses against it -- nothing outside it passes.
   */
  private async mapErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof FilesDeliveryError)) throw e;
      switch (e.reasonCode) {
        case "ARTIFACT_NOT_FOUND":
          // No body. See the header -- byte-identical with a version that does not exist.
          throw new NotFoundException();
        case "DEPENDENCY_UNAVAILABLE":
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        // F34 (V8·22-1): 422 -- the request and the caller's permission are both fine; the
        // OBJECT is the thing that is wrong. Distinct from 503 (retry later, the store came
        // back) and from 404 (nothing here says the artifact does not exist).
        case "INTEGRITY_CHECK_FAILED":
          throw new UnprocessableEntityException({ reasonCode: e.reasonCode });
        case "DOWNLOAD_URL_EXPIRED":
          throw new GoneException({ reasonCode: e.reasonCode });
        case "DOWNLOAD_URL_CONSUMED":
          throw new ConflictException({ reasonCode: e.reasonCode });
      }
    }
  }
}
