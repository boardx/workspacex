/**
 * Binding and backflow routes (F06). Protocol adaptation only -- every judgement is in
 * `application`.
 *
 * ## Why this controller EXISTS, when F04 and F05 shipped none
 *
 * The wall those two hit was D-2: `saveDraft.in` and `pinVersion.in` carry no content while
 * their `out` promises the hash and key of freshly written bytes, so no HTTP handler built to
 * that contract could ever produce a file, and inventing a body shape would have been a
 * second declaration of the request contract.
 *
 * These three operations do not have that problem. `bindToProjectStep.in` carries every field
 * the use case needs, `upgradeBinding.in` likewise, and `listBackflow` is a read. So the
 * routes are built, and the contract's schemas are what validates them -- request AND
 * response (hard rule 6; the response half is asserted in the F06 tests, not enforced by a
 * pipe, because a response pipe turns a schema slip into a production 500).
 *
 * ## Status codes
 *
 *   403 + reasonCode   the caller may not bind / pin / look. The layer that refused is named,
 *                      because UC-0.3 R8 forbids a bare "no permission".
 *   404                no such artifact, no such binding, or a binding in another tenant.
 *                      Deliberately one answer for all three -- distinguishing them makes the
 *                      endpoint an oracle for ids that exist.
 *   409                the transition was refused (CANNOT_DOWNGRADE) or the head moved
 *                      (VERSION_CHANGED). Both are "your view is stale or your request is
 *                      against the rules", and both are recoverable by re-reading.
 *   422                the request is internally inconsistent -- `pinned` with no version,
 *                      `live` on an artifact with no version. See `binding-errors.ts`: the
 *                      contract has NO code for either, which is why they cannot be reported
 *                      with one.
 */
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
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
  type BindingDeps,
  type BindingRepository,
} from "../../application/artifact/binding-ports";
import {
  ArtifactNotFoundError,
  CannotDowngradeError,
  NoProjectRoleError,
  NoVersionToBindError,
  PinnedRequiresVersionError,
  ProjectRoleInsufficientError,
} from "../../application/artifact/binding-errors";
import { bindToProjectStep } from "../../application/artifact/bind-to-project-step";
import { upgradeBinding } from "../../application/artifact/upgrade-binding";
import { listBackflow } from "../../application/artifact/list-backflow";
import { VersionChangedError } from "../../application/artifact/pin-version";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import {
  PROVENANCE_WRITER,
  type ProvenanceWriter,
} from "../../application/provenance/ports";
import type { BindingModeName } from "../../domain/artifact/binding-modes";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const BIND_SCHEMA = C.operations.bindToProjectStep.in;
export const UPGRADE_SCHEMA = C.operations.upgradeBinding.in;
export const BACKFLOW_SCHEMA = C.operations.listBackflow.in;

type BindBody = {
  artifactId: string;
  projectId: string;
  stepId: string;
  mode: BindingModeName;
  sourceVersionId?: string;
};
type UpgradeBody = { bindingId: string; expectedHeadVersion: number };

@Controller()
export class ArtifactBindingController {
  constructor(
    @Inject(BINDING_REPOSITORY) private readonly bindings: BindingRepository,
    @Inject(ARTIFACT_REPOSITORY) private readonly artifacts: ArtifactRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
    @Inject(ID_FACTORY) private readonly ids: IdFactory,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
  ) {}

  private get deps(): BindingDeps {
    return {
      bindings: this.bindings,
      artifacts: this.artifacts,
      auth: { repo: this.identity, ids: this.decisions },
      ids: this.ids,
      provenance: this.provenance,
    };
  }

  @Post("/artifacts/:artifactId/bindings")
  async bind(
    @CurrentPrincipal() principal: Principal,
    @Param("artifactId") artifactId: string,
    // The pipe is on the PARAMETER, never on the method: `@UsePipes` at method level runs
    // against every parameter including `@CurrentPrincipal`, which then fails the contract
    // schema and 400s every request with a message that points at the body.
    @Body(new ZodBodyPipe(BIND_SCHEMA)) body: BindBody,
  ) {
    assertPrincipal(principal);
    // The contract carries `artifactId` in the body AND in the path. Neither is redundant --
    // the path is the resource, the body is what the schema validates -- but they can
    // disagree, and a handler that silently prefers one lets a caller address resource A
    // while the audit trail records B.
    if (body.artifactId !== artifactId) {
      throw new UnprocessableEntityException("artifact_id_mismatch");
    }
    return this.run(() =>
      bindToProjectStep(this.deps, {
        userId: principal.userId,
        orgId: principal.orgId,
        artifactId,
        projectId: body.projectId,
        stepId: body.stepId,
        mode: body.mode,
        sourceVersionId: body.sourceVersionId,
      }),
    );
  }

  @Post("/artifacts/bindings/:bindingId/upgrade")
  async upgrade(
    @CurrentPrincipal() principal: Principal,
    @Param("bindingId") bindingId: string,
    @Body(new ZodBodyPipe(UPGRADE_SCHEMA)) body: UpgradeBody,
  ) {
    assertPrincipal(principal);
    if (body.bindingId !== bindingId) {
      throw new UnprocessableEntityException("binding_id_mismatch");
    }
    return this.run(() =>
      upgradeBinding(this.deps, {
        userId: principal.userId,
        orgId: principal.orgId,
        bindingId,
        expectedHeadVersion: body.expectedHeadVersion,
      }),
    );
  }

  @Get("/projects/:projectId/backflow")
  async backflow(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Query("stepId") stepId?: string,
  ) {
    assertPrincipal(principal);
    // A GET has no body, so the contract's `in` is applied to the assembled parameters
    // instead of skipped. Skipping it is the ordinary shortcut and it means the one
    // operation with no request body is also the one operation nothing validates.
    const input = new ZodBodyPipe(BACKFLOW_SCHEMA).transform({
      projectId,
      ...(stepId === undefined ? {} : { stepId }),
    }) as { projectId: string; stepId?: string };
    return this.run(() =>
      listBackflow(this.deps, {
        userId: principal.userId,
        orgId: principal.orgId,
        projectId: input.projectId,
        stepId: input.stepId,
      }),
    );
  }

  /**
   * The single failure mapping. One table, so a new use case cannot quietly acquire a
   * `default:` branch that turns an unmapped refusal into a 500.
   *
   * Nothing here reads a message off the exception -- `lint-error-leak` forbids it in this
   * layer, and the reason applies here specifically: these messages name artifact ids,
   * binding ids and version ids belonging to whoever the caller was refused access to.
   */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ArtifactNotFoundError) throw new NotFoundException("not_found");
      if (e instanceof NoProjectRoleError) {
        throw new ForbiddenException({ reasonCode: "NO_PROJECT_ROLE" });
      }
      if (e instanceof ProjectRoleInsufficientError) {
        throw new ForbiddenException({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
      }
      if (e instanceof CannotDowngradeError) throw new ConflictException("cannot_downgrade");
      if (e instanceof VersionChangedError) throw new ConflictException("version_changed");
      if (e instanceof PinnedRequiresVersionError || e instanceof NoVersionToBindError) {
        throw new UnprocessableEntityException("binding_request_inconsistent");
      }
      throw e;
    }
  }
}
