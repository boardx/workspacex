/**
 * Identity routes. Protocol adaptation only -- every judgement happens in `application`.
 *
 * Each route's request body is validated by the schema FROM THE CONTRACT, never a local
 * copy (`lint-contract-source` enforces that, and it now scans this package).
 */
import { Body, Controller, Get, Inject, NotFoundException, Post, Query } from "@nestjs/common";
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
  AUTHORIZATION_CACHE,
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  SESSION_STORE,
  type AuthorizationCache,
  type DecisionIdFactory,
  type IdentityRepository,
  type SessionStore,
} from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const AUTHORIZE_SCHEMA = C.operations.authorize.in;
export const AUTHORIZE_BATCH_SCHEMA = C.operations.authorizeBatch.in;
export const SWITCH_ORG_SCHEMA = C.operations.switchOrganization.in;

type AuthorizeBody = { orgId: string; projectId?: string; object: { kind: "project" | "artifact" | "segment"; id: string }; action: string };
type AuthorizeBatchBody = { orgId: string; projectId?: string; objects: { kind: "project" | "artifact" | "segment"; id: string }[]; action: string };

@Controller()
export class IdentityController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(AUTHORIZATION_CACHE) private readonly cache: AuthorizationCache,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
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

  @Get("/identity/me")
  async me(
    @CurrentPrincipal() principal: Principal,
    @Query("orgId") orgId: string,
    @Query("projectId") projectId?: string,
  ) {
    assertPrincipal(principal);
    try {
      const r = await resolveIdentity(this.repo, {
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

  @Post("/identity/switch-org")
  async switchOrg(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(SWITCH_ORG_SCHEMA)) body: { toOrgId: string },
  ) {
    assertPrincipal(principal);
    try {
      return await switchOrganization(
        { repo: this.repo, sessions: this.sessions, cache: this.cache },
        { userId: principal.userId, toOrgId: toOrgId(body.toOrgId) },
      );
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
