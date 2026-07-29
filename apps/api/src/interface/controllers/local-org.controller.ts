/**
 * The personal-local organization's routes (F16). Protocol adaptation only.
 *
 * ## Status codes are the requirement here too
 *
 *   404 NO_ORG_MEMBERSHIP / LOCAL_ORG_ONLY  a caller must not learn that somebody else's
 *                                           local organization exists -- and "this org is
 *                                           personal-local" is itself information about it
 *   409 LOCAL_RUNTIME_UNAVAILABLE           a dependency is down; the CODE is what travels,
 *                                           and the UI reads the startup hint straight from
 *                                           the contract constant
 *   403 CLOUD_MODEL_FORBIDDEN               refused on purpose, never a fallback
 *
 * ⚠ `LOCAL_RUNTIME_UNAVAILABLE` is deliberately NOT a 5xx. A 500 says "we are broken and you
 * can retry"; the truth is "the machine you are on is not running the runtime, go start it".
 * Clients retry 5xx automatically, and an automatic retry here is a loop that never resolves.
 */
import {
  Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, HttpStatus,
  Inject, NotFoundException, Post, Query,
} from "@nestjs/common";
import { identity as C } from "@repo/contracts";
import {
  CapabilityNotFoundError,
  CloudModelForbiddenError,
  LocalOrgOnlyError,
  LocalRuntimeUnavailableError,
  NoOrgMembershipError,
} from "../../application/identity/errors";
import { getLocalOrg } from "../../application/identity/personal-local-org";
import {
  getLocalRuntimeStatus,
  invokeLocalModel,
  type LocalModelDeps,
} from "../../application/identity/invoke-local-model";
import {
  CAPABILITY_REPOSITORY,
  type CapabilityRepository,
} from "../../application/identity/capability-ports";
import {
  EGRESS_GUARD,
  LOCAL_MODEL_RUNTIME,
  type EgressGuard,
  type LocalModelRuntime,
} from "../../application/identity/local-org-ports";
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
} from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const INVOKE_LOCAL_MODEL_SCHEMA = C.operations.invokeLocalModel.in;

type InvokeBody = { orgId: string; capabilityId: string; prompt: string };

@Controller()
export class LocalOrgController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(CAPABILITY_REPOSITORY) private readonly capabilities: CapabilityRepository,
    @Inject(LOCAL_MODEL_RUNTIME) private readonly runtime: LocalModelRuntime,
    @Inject(EGRESS_GUARD) private readonly egress: EgressGuard,
  ) {}

  private get deps(): LocalModelDeps {
    return {
      repo: this.repo,
      capabilities: this.capabilities,
      runtime: this.runtime,
      egress: this.egress,
    };
  }

  /**
   * No parameters -- the organization is resolved from the caller (see the use case).
   * An endpoint that took an org id would be an endpoint that could be pointed at somebody
   * else's local organization, and then the isolation would rest on a check being right
   * forever instead of on there being nothing to check.
   */
  @Get("/identity/local-org")
  async localOrg(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    try {
      return await getLocalOrg(this.repo, principal.userId);
    } catch (e) {
      if (e instanceof NoOrgMembershipError || e instanceof LocalOrgOnlyError) {
        throw new NotFoundException();
      }
      throw e;
    }
  }

  @Get("/identity/local-org/runtime")
  async runtimeStatus(
    @CurrentPrincipal() principal: Principal,
    @Query("orgId") orgId: string,
  ) {
    assertPrincipal(principal);
    try {
      // ⚠ Returns 200 with `available: false`, not an error status. "The runtime is down" is
      // a state the UI renders (dependency-failure), not a failure of this request -- and a
      // status endpoint that errors when the thing is down cannot report that it is down.
      return await getLocalRuntimeStatus(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(orgId),
      });
    } catch (e) {
      if (e instanceof NoOrgMembershipError || e instanceof LocalOrgOnlyError) {
        throw new NotFoundException();
      }
      throw e;
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post("/identity/local-org/model-call")
  async modelCall(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(INVOKE_LOCAL_MODEL_SCHEMA)) body: InvokeBody,
  ) {
    assertPrincipal(principal);
    try {
      return await invokeLocalModel(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(body.orgId),
        capabilityId: body.capabilityId,
        prompt: body.prompt,
      });
    } catch (e) {
      if (e instanceof NoOrgMembershipError || e instanceof LocalOrgOnlyError) {
        throw new NotFoundException();
      }
      if (e instanceof CapabilityNotFoundError) throw new NotFoundException();
      if (e instanceof CloudModelForbiddenError) {
        // Only the CODE crosses the wire. The endpoint is admin-entered configuration and
        // could safely be echoed, but the error boundary passes exactly one field on
        // purpose (see `all-exceptions.filter.ts`), and widening it for convenience is how a
        // response body starts carrying whatever an exception happens to hold.
        throw new ForbiddenException({ reasonCode: "CLOUD_MODEL_FORBIDDEN" });
      }
      if (e instanceof LocalRuntimeUnavailableError) {
        // The hint is NOT sent: `LOCAL_RUNTIME_STARTUP_HINT` is a contract constant the
        // frontend already has. Shipping the sentence would put the same operational
        // instruction in two places -- and `getLocalRuntimeStatus` is where a hint legitimately
        // travels, because there it is a contract-described field of a 200 body.
        throw new ConflictException({ reasonCode: "LOCAL_RUNTIME_UNAVAILABLE" });
      }
      throw e;
    }
  }
}
