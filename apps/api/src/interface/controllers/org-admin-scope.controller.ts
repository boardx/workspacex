/**
 * `org-admin` visibility-scope route (F07). Protocol adaptation only — the judgement
 * happens in `application`, which in turn delegates to phase-00 `identity`.
 *
 * Request shape comes FROM THE CONTRACT (`lint-contract-source`); there is no local schema
 * in this file and there must not be one.
 */
import { BadRequestException, Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { orgAdmin as C } from "@repo/contracts";
import type { z } from "zod";
import {
  CAPABILITY_REPOSITORY,
  type CapabilityRepository,
} from "../../application/identity/capability-ports";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import {
  UnjudgeableResourceKindError,
  resolveResourceScope,
} from "../../application/org-admin/resolve-resource-scope";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const RESOLVE_RESOURCE_SCOPE_SCHEMA = C.operations.resolveResourceScope.in;

/** Derived from the contract, never restated. */
type ResolveResourceScopeIn = z.infer<typeof RESOLVE_RESOURCE_SCOPE_SCHEMA>;

/**
 * ⚠ `orgId` is the PATH segment, so the query alone is not the contract's input. The full
 * input is reassembled and run through the contract schema in the handler — validating only
 * the query would leave the tenant selector unchecked, which is the one field a caller has
 * the most reason to tamper with.
 */
const FULL_INPUT_PIPE = new ZodBodyPipe(RESOLVE_RESOURCE_SCOPE_SCHEMA);

@Controller()
export class OrgAdminScopeController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(CAPABILITY_REPOSITORY) private readonly capabilities: CapabilityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
  ) {}

  /**
   * Always 200, even when denied — same rule as `POST /identity/authorize`.
   *
   * A 403 would collapse the layered explanation into a status code, and the layered
   * explanation IS the feature: uc-1-4 R3 requires a wrong-team denial to say it came from
   * the ORG layer, because a user told merely "no permission" goes looking for a project
   * role they already have and finds nothing there to change.
   */
  @Get("/organizations/:orgId/resource-scope")
  async resolve(
    @CurrentPrincipal() principal: Principal,
    @Param("orgId") orgId: string,
    // No pipe on this parameter: the contract's schema is `.strict()` over the WHOLE input
    // including `orgId`, so running it against the query alone would reject every request.
    @Query() query: unknown,
  ) {
    assertPrincipal(principal);
    const input = FULL_INPUT_PIPE.transform({
      orgId,
      resource: (query as { resource?: unknown } | null)?.resource,
    }) as ResolveResourceScopeIn;

    try {
      return await resolveResourceScope(
        { repo: this.repo, capabilities: this.capabilities, ids: this.ids },
        { userId: principal.userId, orgId: toOrgId(input.orgId), resource: input.resource },
      );
    } catch (e) {
      // A kind outside the closed capability set is a malformed request, not a verdict.
      // Answering it with a normal-looking denial would let `canvas_template` read as an
      // authorization result forever. The message is not echoed (lint-error-leak).
      if (e instanceof UnjudgeableResourceKindError) {
        throw new BadRequestException({ fields: [{ path: "resource.kind", code: "invalid_enum_value" }] });
      }
      throw e;
    }
  }
}
