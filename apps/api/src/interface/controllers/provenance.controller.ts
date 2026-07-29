/**
 * The audit trail's single query surface (coherence review X-2).
 *
 * It lives in its own controller rather than under `IdentityController` for a reason that
 * is about more than tidiness: `provenance_events` belongs to NO bundle. The identity and
 * artifact bundles both write to it, and hanging the reader off one of them is the first
 * step toward the other one building its own.
 *
 * There is no POST, PUT, PATCH or DELETE here. That absence is asserted from two other
 * directions -- `no-forbidden-routes.test.ts` in the contracts package checks the route
 * table, and migration 0005 gives the runtime database role SELECT and INSERT only.
 */
import { Controller, Get, Inject, NotFoundException, Query, ForbiddenException } from "@nestjs/common";
import { provenance as P } from "@repo/contracts";
import {
  PROVENANCE_READER,
  type ProvenanceQuery,
  type ProvenanceReader,
} from "../../application/provenance/ports";
import {
  ProvenanceForbiddenError,
  queryProvenance,
} from "../../application/provenance/query-provenance";
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
} from "../../application/identity/ports";
import { NoOrgMembershipError } from "../../application/identity/switch-organization";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

/** The contract's `in` schema. Query strings arrive as strings, so it is coerced first. */
const QUERY_SCHEMA = P.operations.queryProvenance.in;

@Controller()
export class ProvenanceController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(PROVENANCE_READER) private readonly reader: ProvenanceReader,
  ) {}

  @Get("/provenance")
  async query(
    @CurrentPrincipal() principal: Principal,
    @Query() raw: Record<string, string | string[] | undefined>,
  ) {
    assertPrincipal(principal);

    // `ZodBodyPipe` is not usable here -- there is no body. The schema still comes from
    // the contract; only the string-to-number/array coercion happens locally, because a
    // query string cannot express those types and the contract should not be bent to
    // describe HTTP's encoding.
    const parsed = QUERY_SCHEMA.safeParse({
      orgId: raw.orgId,
      types: raw.types === undefined ? undefined : ([] as string[]).concat(raw.types),
      actorId: raw.actorId,
      targetKind: raw.targetKind,
      targetId: raw.targetId,
      since: raw.since,
      until: raw.until,
      limit: raw.limit === undefined ? undefined : Number(raw.limit),
      cursor: raw.cursor,
    });
    // Deliberately 404 and not 400: an invalid filter is indistinguishable from a query
    // that matched nothing, and this endpoint's whole subject matter is who looked at what.
    if (!parsed.success) throw new NotFoundException();

    const { orgId, ...filter } = parsed.data as ProvenanceQuery;
    try {
      return await queryProvenance(
        { repo: this.repo, reader: this.reader },
        { requesterId: principal.userId, orgId: toOrgId(orgId), filter },
      );
    } catch (e) {
      // Not a member: 404, so the response does not confirm the organization exists.
      if (e instanceof NoOrgMembershipError) throw new NotFoundException();
      // A member without the mandate: 403 with the layered reason, per UC-0.3 R8.
      if (e instanceof ProvenanceForbiddenError) {
        throw new ForbiddenException({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
      }
      throw e;
    }
  }
}
