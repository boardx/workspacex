/**
 * The downstream citation route (F07). Protocol adaptation only -- every judgement is in
 * `application`.
 *
 * Its own controller rather than a fourth method on `ArtifactBindingController`, because it
 * is the door five other bundles will knock on. A route that lives next to the binding
 * routes reads as part of the binding service, and R11 is explicit that this gate must be
 * separable and separately accepted.
 *
 * ## Status codes
 *
 *   404  no such version, or a version in another tenant. One answer for both, so the
 *        endpoint is not an oracle for ids.
 *   409  the version is not a pinned snapshot (`REQUIRES_PINNED`). A conflict rather than a
 *        422: the request is well-formed and the resource is in the wrong state, and the
 *        state is fixable by pinning -- which is precisely what the response body offers.
 */
import {
  Body,
  ConflictException,
  Controller,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import { artifact as C } from "@repo/contracts";
import {
  ARTIFACT_REPOSITORY,
  ID_FACTORY,
  type ArtifactRepository,
  type IdFactory,
} from "../../application/artifact/ports";
import {
  BINDING_REPOSITORY,
  type BindingRepository,
} from "../../application/artifact/binding-ports";
import {
  DOWNSTREAM_REFERENCE_REPOSITORY,
  type DownstreamReferenceRepository,
} from "../../application/artifact/reference-ports";
import {
  ArtifactNotFoundError,
  RequiresPinnedError,
} from "../../application/artifact/binding-errors";
import {
  referenceForDownstream,
  type ReferenceDeps,
} from "../../application/artifact/reference-for-downstream";
import type { DownstreamPurposeName } from "../../domain/artifact/downstream-eligibility";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const REFERENCE_SCHEMA = C.operations.referenceForDownstream.in;

type ReferenceBody = {
  versionId: string;
  purpose: DownstreamPurposeName;
  referencedBy: { kind: string; id: string };
};

@Controller()
export class ArtifactReferenceController {
  constructor(
    @Inject(DOWNSTREAM_REFERENCE_REPOSITORY)
    private readonly references: DownstreamReferenceRepository,
    @Inject(BINDING_REPOSITORY) private readonly bindings: BindingRepository,
    @Inject(ARTIFACT_REPOSITORY) private readonly artifacts: ArtifactRepository,
    @Inject(ID_FACTORY) private readonly ids: IdFactory,
  ) {}

  private get deps(): ReferenceDeps {
    return {
      references: this.references,
      bindings: this.bindings,
      artifacts: this.artifacts,
      ids: this.ids,
    };
  }

  @Post("/artifacts/versions/:versionId/references")
  async reference(
    @CurrentPrincipal() principal: Principal,
    @Param("versionId") versionId: string,
    @Body(new ZodBodyPipe(REFERENCE_SCHEMA)) body: ReferenceBody,
  ) {
    assertPrincipal(principal);
    // Path and body both carry the version id. A handler that silently prefers one lets a
    // caller address version A while the citation records B -- and a citation is exactly the
    // record whose whole purpose is to say which bytes were looked at.
    if (body.versionId !== versionId) {
      throw new UnprocessableEntityException("version_id_mismatch");
    }
    try {
      return await referenceForDownstream(this.deps, {
        userId: principal.userId,
        orgId: principal.orgId,
        versionId,
        purpose: body.purpose,
        referencedBy: body.referencedBy,
      });
    } catch (e) {
      if (e instanceof ArtifactNotFoundError) throw new NotFoundException("not_found");
      if (e instanceof RequiresPinnedError) {
        // The ONE piece of detail this refusal carries, and it is not read off the
        // exception's message: E1 requires 一键定版 to be offered, and the interface cannot
        // address an artifact it was never told about. The caller already holds a version of
        // this artifact, so naming its parent discloses nothing new.
        throw new ConflictException({
          artifactError: "REQUIRES_PINNED",
          artifactId: e.artifactId,
        });
      }
      throw e;
    }
  }
}
