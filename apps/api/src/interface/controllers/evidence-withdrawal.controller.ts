/**
 * `POST /artifacts/versions/:versionId/evidence-withdrawn` (E5 / F08).
 *
 * Its own controller rather than a fifth method on `ArtifactBindingController`, because the
 * two answer to different halves of the bundle: that one is about where a product is
 * attached, this one is about the audit trail reacting to something upstream. Sharing a
 * class would also share `run()`'s failure table, and this operation's contract declares
 * only TWO codes -- inheriting a mapping for six would suggest it can produce them.
 *
 * ## Status codes, and the one that is doing security work
 *
 *   404   no such version, a version in another tenant, OR a caller who is not a member of
 *         the organization. One answer for all three, deliberately: the alternative tells a
 *         stranger which version ids are real, and this endpoint's whole subject is which
 *         evidence exists.
 *   503   the trail or the notice could not be written (`DEPENDENCY_UNAVAILABLE`). NOT a
 *         silent success: E5's value is that somebody is told, so a withdrawal that could
 *         not notify is a withdrawal that did not happen.
 *
 * There is no 403. The contract has no code for one -- see `withdraw-evidence.ts`.
 */
import {
  Body,
  Controller,
  Inject,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import { artifact as C } from "@repo/contracts";
import {
  ARTIFACT_REPOSITORY,
  type ArtifactRepository,
} from "../../application/artifact/ports";
import {
  BINDING_REPOSITORY,
  type BindingRepository,
} from "../../application/artifact/binding-ports";
import { ArtifactNotFoundError } from "../../application/artifact/binding-errors";
import { withdrawEvidence } from "../../application/artifact/withdraw-evidence";
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
} from "../../application/identity/ports";
import {
  PROVENANCE_WRITER,
  REVIEW_NOTIFIER,
  type ProvenanceWriter,
  type ReviewNotifier,
} from "../../application/provenance/ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const WITHDRAW_SCHEMA = C.operations.markEvidenceWithdrawn.in;

type WithdrawBody = { versionId: string; reason: string };

@Controller()
export class EvidenceWithdrawalController {
  constructor(
    @Inject(ARTIFACT_REPOSITORY) private readonly artifacts: ArtifactRepository,
    @Inject(BINDING_REPOSITORY) private readonly bindings: BindingRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
    @Inject(REVIEW_NOTIFIER) private readonly notifier: ReviewNotifier,
  ) {}

  @Post("/artifacts/versions/:versionId/evidence-withdrawn")
  async withdraw(
    @CurrentPrincipal() principal: Principal,
    @Param("versionId") versionId: string,
    @Body(new ZodBodyPipe(WITHDRAW_SCHEMA)) body: WithdrawBody,
  ) {
    assertPrincipal(principal);
    // Same rule as the bind route: the contract carries the id in both places and a handler
    // that silently prefers one lets a caller address version A while the trail records B --
    // which on THIS endpoint would forge an audit record, not merely confuse one.
    if (body.versionId !== versionId) throw new NotFoundException("not_found");

    try {
      return await withdrawEvidence(
        {
          artifacts: this.artifacts,
          bindings: this.bindings,
          identity: this.identity,
          provenance: this.provenance,
          notifier: this.notifier,
        },
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          versionId,
          reason: body.reason,
        },
      );
    } catch (e) {
      if (e instanceof ArtifactNotFoundError) throw new NotFoundException("not_found");
      // Anything else got as far as the writes. `DEPENDENCY_UNAVAILABLE` is the contract's
      // word for it and it is the honest one: the caller may safely retry, and the retry is
      // idempotent per (event, recipient) at the database.
      throw new ServiceUnavailableException("dependency_unavailable");
    }
  }
}
