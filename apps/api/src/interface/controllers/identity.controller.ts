/**
 * Identity routes. Protocol adaptation only -- every judgement happens in `application`.
 *
 * Each route's request body is validated by the schema FROM THE CONTRACT, never a local
 * copy (`lint-contract-source` enforces that, and it now scans this package).
 */
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Inject,
  NotFoundException, Patch, Post, Query,
} from "@nestjs/common";
import { identity as C } from "@repo/contracts";
import {
  authorize,
  authorizeBatch,
  type AuthorizeDeps,
} from "../../application/identity/authorize";
import {
  NoOrgMembershipError,
  resolveIdentity,
  switchOrganization,
} from "../../application/identity/switch-organization";
import {
  ContentDeniedError,
  ContentNotFoundError,
  readContent,
} from "../../application/identity/read-content";
import { getPersonalLayerSummary } from "../../application/identity/personal-layer-summary";
import { resolveModelConstraint } from "../../application/identity/resolve-model-constraint";
import { UpdateOwnProfileError, updateOwnProfile } from "../../application/identity/update-own-profile";
import {
  CAPABILITY_REPOSITORY,
  type CapabilityRepository,
} from "../../application/identity/capability-ports";
import { CREDENTIAL_REPOSITORY, type CredentialRepository } from "../../application/auth/ports";
import {
  CONTENT_REPOSITORY,
  type ContentRepository,
} from "../../application/identity/content-ports";
import {
  PROVENANCE_WRITER,
  type ProvenanceWriter,
} from "../../application/provenance/ports";
import {
  AUTHORIZATION_CACHE,
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  SESSION_STORE,
  type AuthorizationCache,
  type DecisionIdFactory,
  type IdentityRepository,
  type SessionStore,
} from "../../application/identity/ports";
import type { ReadPurpose } from "../../domain/identity/admin-boundary";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const AUTHORIZE_SCHEMA = C.operations.authorize.in;
export const AUTHORIZE_BATCH_SCHEMA = C.operations.authorizeBatch.in;
export const SWITCH_ORG_SCHEMA = C.operations.switchOrganization.in;
export const READ_CONTENT_SCHEMA = C.operations.readContent.in;
export const MODEL_CONSTRAINT_SCHEMA = C.operations.resolveModelConstraint.in;
export const UPDATE_OWN_PROFILE_SCHEMA = C.operations.updateOwnProfile.in;

type AuthorizeBody = { orgId: string; projectId?: string; object: { kind: "project" | "artifact" | "segment"; id: string }; action: string };
type AuthorizeBatchBody = { orgId: string; projectId?: string; objects: { kind: "project" | "artifact" | "segment"; id: string }[]; action: string };
type ReadContentBody = { orgId: string; projectId: string; itemId: string; purpose: ReadPurpose };
type ModelConstraintBody = { orgId: string; dataScope: { itemId: string; confidential: boolean }[] };
type UpdateOwnProfileBody = { displayName?: string; avatarArtifactId?: string | null };

@Controller()
export class IdentityController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(AUTHORIZATION_CACHE) private readonly cache: AuthorizationCache,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(CONTENT_REPOSITORY) private readonly content: ContentRepository,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
    @Inject(CAPABILITY_REPOSITORY) private readonly capabilities: CapabilityRepository,
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
  ) {}

  private get deps(): AuthorizeDeps {
    return { repo: this.repo, ids: this.ids };
  }

  /**
   * Always 200, even when denied.
   *
   * A denial is a RESULT here, not an error -- returning 403 would throw away the layered
   * explanation the UI needs to say "this is an org-level restriction, not a project one".
   * The endpoints that ACT on a resource are the ones that return 403; this one reports.
   */
  @Post("/identity/authorize")
  async authorize(
    @CurrentPrincipal() principal: Principal,
    // The pipe is attached to the PARAMETER, not the method.
    //
    // `@UsePipes` at method level runs against EVERY parameter, including custom param
    // decorators -- so the contract schema would also be applied to the principal, which
    // fails it, and every request 400s. The symptom looks like a bad request body, so the
    // first instinct is to go debug the client.
    @Body(new ZodBodyPipe(AUTHORIZE_SCHEMA)) body: AuthorizeBody,
  ) {
    assertPrincipal(principal);
    return authorize(this.deps, {
      userId: principal.userId,
      orgId: toOrgId(body.orgId),
      projectId: body.projectId,
      object: body.object,
      action: body.action,
    });
  }

  @Post("/identity/authorize-batch")
  async authorizeBatch(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(AUTHORIZE_BATCH_SCHEMA)) body: AuthorizeBatchBody,
  ) {
    assertPrincipal(principal);
    // Same length, same order as the input -- callers must never have to match by id.
    return authorizeBatch(this.deps, {
      userId: principal.userId,
      orgId: toOrgId(body.orgId),
      projectId: body.projectId,
      objects: body.objects,
      action: body.action,
    });
  }

  /**
   * The read path the admin boundary is actually about (F03 / D-18).
   *
   * ## The status codes here are the requirement, not a detail
   *
   *   403 + reasonCode  the caller may not read this, and the UI can say which layer
   *                     closed the door (UC-0.3 R8 -- never a bare "no permission")
   *   404               the item does not exist, OR it is somebody else's draft. These are
   *                     deliberately the same response: 403 on a draft answers the question
   *                     "is there something here", and for a draft that answer is the leak
   *                     (uc-0-1 V4)
   *   404 on NO_ORG_MEMBERSHIP  a denial must not reveal that the organization exists
   *
   * ## Why the schema is on the parameter
   *
   * A method-level `@UsePipes` runs against EVERY parameter including `@CurrentPrincipal`,
   * so the contract schema would be applied to the principal, fail, and 400 every request.
   * The symptom reads as a malformed body, which sends you to debug the client.
   */
  // 200, not Nest's default 201 for POST. The verb is POST because the operation has a
  // side effect (the audit row), but nothing is CREATED from the caller's point of view --
  // and a client that branches on 201 would treat every read as a write.
  @HttpCode(HttpStatus.OK)
  @Post("/identity/content/read")
  async readContent(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(READ_CONTENT_SCHEMA)) body: ReadContentBody,
  ) {
    assertPrincipal(principal);
    try {
      return await readContent(
        { repo: this.repo, ids: this.ids, content: this.content, provenance: this.provenance },
        {
          userId: principal.userId,
          orgId: toOrgId(body.orgId),
          projectId: body.projectId,
          itemId: body.itemId,
          purpose: body.purpose,
        },
      );
    } catch (e) {
      if (e instanceof ContentNotFoundError) throw new NotFoundException();
      if (e instanceof ContentDeniedError) {
        if (e.reasonCode === "NO_ORG_MEMBERSHIP") throw new NotFoundException();
        // The reason code travels in the body, not in the status. Four denial reasons
        // collapsed into one 403 is exactly the "just show 'no permission'" that R8 rules
        // out -- the user cannot tell an org-layer restriction from a project-layer one.
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /**
   * Counts, and nothing else -- invariant I-8.
   *
   * There is no sibling route that returns personal-layer content, and that absence is the
   * design: the only way to read someone's personal item is `/identity/content/read`,
   * which refuses it for anyone but the owner regardless of org role or stated purpose.
   */
  @Get("/identity/personal-layer/summary")
  async personalLayerSummary(
    @CurrentPrincipal() principal: Principal,
    @Query("orgId") orgId: string,
    @Query("userId") userId: string,
  ) {
    assertPrincipal(principal);
    try {
      return await getPersonalLayerSummary(
        { repo: this.repo, content: this.content },
        { requesterId: principal.userId, orgId: toOrgId(orgId), userId },
      );
    } catch (e) {
      if (e instanceof NoOrgMembershipError) throw new NotFoundException();
      throw e;
    }
  }

  @Get("/identity/me")
  async me(
    @CurrentPrincipal() principal: Principal,
    @Query("orgId") orgId: string,
    @Query("projectId") projectId?: string,
  ) {
    assertPrincipal(principal);
    try {
      const r = await resolveIdentity(this.repo, this.credentials, {
        userId: principal.userId,
        orgId: toOrgId(orgId),
        projectId,
      });
      return r;
    } catch (e) {
      // 404, not 403: a denial must not reveal whether the organization exists.
      if (e instanceof NoOrgMembershipError) throw new NotFoundException();
      throw e;
    }
  }

  /**
   * `updateOwnProfile`（#638 delta，迭代 1）—— 目前只有 `displayName` 真的落库。
   *
   * `avatarArtifactId` 非 null 一律 400 `INVALID_INPUT`——`uploadOwnAvatar` 本轮
   * 未实现，见 `application/identity/update-own-profile.ts` 头部注释。
   */
  @Patch("/identity/me")
  async updateMe(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(UPDATE_OWN_PROFILE_SCHEMA)) body: UpdateOwnProfileBody,
  ) {
    assertPrincipal(principal);
    try {
      return await updateOwnProfile(
        { credentials: this.credentials },
        { userId: principal.userId, displayName: body.displayName, avatarArtifactId: body.avatarArtifactId },
      );
    } catch (e) {
      if (e instanceof UpdateOwnProfileError) {
        if (e.reasonCode === "AVATAR_ARTIFACT_NOT_OWNED") throw new ForbiddenException({ reasonCode: e.reasonCode });
        throw new BadRequestException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  @Post("/identity/switch-org")
  async switchOrg(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(SWITCH_ORG_SCHEMA)) body: { toOrgId: string },
  ) {
    assertPrincipal(principal);
    try {
      return await switchOrganization(
        {
          repo: this.repo,
          sessions: this.sessions,
          cache: this.cache,
          // Switching organizations returns the NEW organization's whole configuration --
          // that post-effect is contract text, not an optimisation (O-12 + F15).
          capabilities: this.capabilities,
          ids: this.ids,
        },
        { userId: principal.userId, toOrgId: toOrgId(body.toOrgId) },
      );
    } catch (e) {
      if (e instanceof NoOrgMembershipError) throw new NotFoundException();
      throw e;
    }
  }

  /**
   * The ONE place that answers "must this round stay local, and why" (coherence B-3 / X-5).
   *
   * POST rather than GET because `dataScope` is a list that can be long and describes what is
   * about to be processed -- a request body, not a bookmarkable address. It has no side
   * effect.
   *
   * ⚠ `source` is the load-bearing half of the response, not `localOnly`: a personal-local
   * organization's `promise` and a real organization's `policy` produce the same boolean and
   * differ in whether anybody can switch them off (uc-0-5 R10 ruling / V12).
   */
  @HttpCode(HttpStatus.OK)
  @Post("/identity/model-constraint")
  async modelConstraint(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(MODEL_CONSTRAINT_SCHEMA)) body: ModelConstraintBody,
  ) {
    assertPrincipal(principal);
    try {
      return await resolveModelConstraint(this.repo, {
        userId: principal.userId,
        orgId: toOrgId(body.orgId),
        dataScope: body.dataScope,
      });
    } catch (e) {
      if (e instanceof NoOrgMembershipError) throw new NotFoundException();
      throw e;
    }
  }

  /**
   * Session snapshot.
   *
   * Deliberately under `/kernel/probe/`, not `/identity/`: it is NOT contract surface. The
   * contract defines nine identity operations and this is not one of them, so putting it at
   * `/identity/session` would quietly grow the public API past what was signed off.
   *
   * It exists because O-12's post-effects ("project context cleared, no cached verdict
   * reused") are only assertable if something can observe them -- same reasoning as the
   * `rls_probe` table. An unobservable requirement stops being true without anyone noticing.
   */
  @Get("/kernel/probe/identity-session")
  async session(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    return {
      ...(await this.sessions.get(principal.userId)),
      cachedDecisions: await this.cache.size(principal.userId),
    };
  }
}
