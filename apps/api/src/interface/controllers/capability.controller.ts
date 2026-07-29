/**
 * Capability routes (F15). Protocol adaptation only -- every judgement happens in
 * `application`.
 *
 * ## What is NOT in this file
 *
 * Any list of agents, skills, models, MCPs, templates or blueprints. The whole feature is
 * that those come from the organization's configuration; a "sensible starting set" here
 * would be the product built-in wearing a controller's clothes, and it is the layer where
 * one would be least likely to be looked for. `no-builtin-capability-lists.test.ts` scans
 * for it rather than trusting this paragraph.
 *
 * Request schemas come FROM THE CONTRACT, never a local copy (`lint-contract-source`).
 */
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Query,
} from "@nestjs/common";
import { identity as C } from "@repo/contracts";
import {
  CAPABILITY_REPOSITORY,
  IN_FLIGHT_CALLS,
  type CapabilityRepository,
  type InFlightCallRegistry,
} from "../../application/identity/capability-ports";
import { NoOrgMembershipError } from "../../application/identity/errors";
import { listCapabilities } from "../../application/identity/list-capabilities";
import {
  CapabilityDeniedError,
  CapabilityNotFoundError,
  CapabilityPayloadError,
  mutateCapability,
} from "../../application/identity/mutate-capability";
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
import type {
  CapabilityKind,
  DisableMode,
  MutateCapabilityOp,
} from "../../domain/identity/capability-listing";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ContractValidationError, ZodBodyPipe } from "../pipes/zod-body.pipe";

export const LIST_CAPABILITIES_SCHEMA = C.operations.listCapabilities.in;
export const MUTATE_CAPABILITY_SCHEMA = C.operations.mutateCapability.in;

type ListQuery = { orgId: string; kind: CapabilityKind };
type MutateBody = {
  orgId: string;
  kind: CapabilityKind;
  op: MutateCapabilityOp;
  payload: Record<string, unknown>;
  disableMode?: DisableMode;
};

@Controller()
export class CapabilityController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(CAPABILITY_REPOSITORY) private readonly capabilities: CapabilityRepository,
    @Inject(IN_FLIGHT_CALLS) private readonly inFlight: InFlightCallRegistry,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
  ) {}

  /**
   * The organization's configured capabilities of one kind, filtered to this caller.
   *
   * Returns the ARRAY only, as the contract says -- the `withheld` half stays in the use
   * case. That is a real limitation and it is the contract's: R12 V10 wants "exists but
   * restricted to a team" to be distinguishable from "this organization does not have it",
   * and `out: CapabilityListing[]` has nowhere to put the difference. Asserted at the use
   * case, reported in the F15 notes; not invented into the response.
   *
   * The pipe sits on the PARAMETER (see identity.controller for what a method-level
   * `@UsePipes` does to `@CurrentPrincipal`). `ZodBodyPipe` is not body-specific -- it runs
   * a contract schema over whatever part of the request it is attached to, and a query
   * string with `kind: "agnet"` has to fail here rather than return an empty list that looks
   * like an unconfigured organization.
   */
  @Get("/capabilities")
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodBodyPipe(LIST_CAPABILITIES_SCHEMA)) query: ListQuery,
  ) {
    assertPrincipal(principal);
    try {
      const { visible } = await listCapabilities(
        { repo: this.repo, capabilities: this.capabilities, ids: this.ids },
        { userId: principal.userId, orgId: toOrgId(query.orgId), kind: query.kind },
      );
      return visible;
    } catch (e) {
      // 404, not 403: a denial must not reveal whether the organization exists. Same rule
      // every other identity route follows.
      if (e instanceof NoOrgMembershipError) throw new NotFoundException();
      throw e;
    }
  }

  // 200, not Nest's default 201. `add` does create a row, but `update` and `disable` share
  // this route and do not -- one verb answering 201 a third of the time is worse than one
  // that never does.
  @HttpCode(HttpStatus.OK)
  @Post("/capabilities/mutate")
  async mutate(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(MUTATE_CAPABILITY_SCHEMA)) body: MutateBody,
  ) {
    assertPrincipal(principal);
    try {
      return await mutateCapability(
        {
          repo: this.repo,
          capabilities: this.capabilities,
          inFlight: this.inFlight,
          provenance: this.provenance,
          ids: this.ids,
        },
        {
          actorId: principal.userId,
          orgId: toOrgId(body.orgId),
          kind: body.kind,
          op: body.op,
          payload: body.payload,
          disableMode: body.disableMode,
        },
      );
    } catch (e) {
      if (e instanceof NoOrgMembershipError) throw new NotFoundException();
      if (e instanceof CapabilityNotFoundError) throw new NotFoundException();
      if (e instanceof CapabilityDeniedError) {
        // The reason code travels in the body, not in the status: two denial reasons
        // collapsed into one bare 403 is the "just show 'no permission'" UC-0.3 R8 rules out.
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      if (e instanceof CapabilityPayloadError) {
        // Raised as the SAME error the contract pipe raises, not as a second kind of 400.
        // `AllExceptionsFilter` lets field-level detail through for exactly one exception
        // type -- a parallel channel would either be stripped (silently returning a bare
        // 400) or would need the filter to trust a second shape.
        throw new ContractValidationError(e.fields);
      }
      throw e;
    }
  }
}
