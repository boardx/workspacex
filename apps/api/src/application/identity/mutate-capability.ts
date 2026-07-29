/**
 * `MutateCapability` -- add / update / disable one entry in the organization's configuration
 * (F15 / uc-0-5 R4 A3, R7 "every change is recorded", D-U5).
 *
 * ## Three things happen and none of them is optional
 *
 *   1. the admin check (R5: members follow, they do not override)
 *   2. the write
 *   3. a `provenance_events` row carrying the BEFORE and AFTER values (R12 V8)
 *
 * Step 3 is ordered last and its failure fails the whole operation, same rule
 * `readContent` follows for audit reads: "the change landed, the record did not" is the one
 * outcome an audit trail may not produce.
 *
 * ## `affectedInFlightCalls` is an answer, not a statistic
 *
 * The contract says so explicitly: the confirmation dialog shows "N in-flight calls will be
 * interrupted", and the admin chooses `interrupt` or `drain` on the strength of it. So it is
 * read from the registry that actually knows, and the disable is applied THROUGH that
 * registry -- see `InFlightCallRegistry` for what phase-00 does and does not have behind it.
 */
import { identity } from "@repo/contracts";
import type { z } from "zod";
import {
  canMutateCapabilities,
  decideCapabilityVisibility,
  DEFAULT_DISABLE_MODE,
  type CapabilityKind,
  type CapabilityListing,
  type DisableMode,
  type MutateCapabilityOp,
} from "../../domain/identity/capability-listing";
import type { OrgId } from "../../domain/org-id";
import { isDisclosed, discloseDecided } from "../security/permission-filter";
import type {
  CapabilityRepository,
  GuardedCapability,
  InFlightCallRegistry,
} from "./capability-ports";
import type { ProvenanceWriter } from "../provenance/ports";
import type { DecisionIdFactory, IdentityRepository, OrgMembershipRow } from "./ports";
import { NoOrgMembershipError } from "./switch-organization";

/**
 * The per-op payload schemas come FROM THE CONTRACT.
 *
 * They did not exist there when F15 started -- `payload` was `z.record(z.unknown())`, so the
 * shape an `add` needs was going to be declared on the backend by whoever implemented it.
 * That is the exact drift ADR-020 exists to prevent, and `contract-single-source.test.ts`
 * refuses any `z.object(` under `src/` for precisely this reason. The gate was right; the
 * shape moved into `packages/contracts/src/identity.ts` with a note explaining why.
 *
 * Applied per op HERE rather than by the validation pipe, because `op` is a sibling of
 * `payload` rather than a discriminator: a union in `in` would reject a bad payload with
 * `invalid_union` and no field path, which is the validation-layer version of the bare "no
 * permission" R8 forbids. See the contract's note -- the trade-off is written down there.
 */
const AddPayload = identity.CapabilityAddPayload;
const UpdatePayload = identity.CapabilityUpdatePayload;
const DisablePayload = identity.CapabilityDisablePayload;

export class CapabilityDeniedError extends Error {
  constructor(readonly reasonCode: "PROJECT_ROLE_INSUFFICIENT" | "ORG_SCOPE_DENIED") {
    super(reasonCode);
  }
}

/** A malformed `payload`. Field-level, like `ZodBodyPipe`: a blanket 400 tells nobody what to fix. */
export class CapabilityPayloadError extends Error {
  constructor(readonly fields: readonly { path: string; code: string }[]) {
    super("validation_failed");
  }
}

export class CapabilityNotFoundError extends Error {}

export interface MutateCapabilityDeps {
  readonly repo: IdentityRepository;
  readonly capabilities: CapabilityRepository;
  readonly inFlight: InFlightCallRegistry;
  readonly provenance: ProvenanceWriter;
  readonly ids: DecisionIdFactory;
}

export interface MutateCapabilityInput {
  readonly actorId: string;
  readonly orgId: OrgId;
  readonly kind: CapabilityKind;
  readonly op: MutateCapabilityOp;
  readonly payload: Record<string, unknown>;
  readonly disableMode?: DisableMode;
}

export interface MutateCapabilityResult {
  readonly listing: CapabilityListing;
  readonly provenanceEventId: string;
  readonly affectedInFlightCalls: number;
}

const parse = <T extends z.ZodTypeAny>(schema: T, payload: unknown): z.infer<T> => {
  const r = schema.safeParse(payload);
  if (r.success) return r.data;
  throw new CapabilityPayloadError(
    r.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", code: i.code })),
  );
};

/**
 * Unwrap a row the ADMIN is acting on.
 *
 * Still goes through the guard rather than around it. An admin's own scope decision is
 * evaluated exactly like anybody else's, which is what stops "administrator" from meaning
 * "sees every team's configuration" by accident (D-18's shape, applied to configuration).
 */
function open(
  row: GuardedCapability,
  deps: MutateCapabilityDeps,
  membership: OrgMembershipRow,
): CapabilityListing {
  const decision = decideCapabilityVisibility({
    decisionId: deps.ids.next(),
    orgRole: membership.orgRole,
    requesterTeamId: membership.teamId,
    scope: row.facts.scope,
    ownerTeamId: row.facts.ownerTeamId,
  });
  const r = discloseDecided(row.listing, decision);
  if (!isDisclosed(r)) throw new CapabilityDeniedError("ORG_SCOPE_DENIED");
  return r.payload;
}

export async function mutateCapability(
  deps: MutateCapabilityDeps,
  input: MutateCapabilityInput,
): Promise<MutateCapabilityResult> {
  const { repo, capabilities, inFlight, provenance } = deps;
  const { actorId, orgId, kind, op } = input;

  const membership = await repo.findOrgMembership(actorId, orgId);
  // Not a member: 404 at the edge, because whether this organization exists is not the
  // caller's business. The contract's `err` list for this operation does not include
  // NO_ORG_MEMBERSHIP -- reported as a gap; the behaviour follows the project's existing
  // non-disclosure rule rather than inventing a code.
  if (membership === null) throw new NoOrgMembershipError();

  if (!canMutateCapabilities(membership.orgRole)) {
    // A refused attempt is recorded before it is refused. The shared provenance contract is
    // explicit that `unauthorized-attempt` exists because "a denied action that leaves no
    // trace lets an attacker probe for free" -- and a configuration surface is exactly what
    // somebody probes. The target is the ORGANIZATION, not a capability: for `op: "add"`
    // there is no capability id yet, and inventing one would put a row in the trail that
    // names something that never existed.
    await provenance.append({
      orgId,
      type: "unauthorized-attempt",
      actorId,
      target: { kind: "organization", id: orgId },
      detail: { operation: "mutateCapability", op, kind, orgRole: membership.orgRole,
                reasonCode: "PROJECT_ROLE_INSUFFICIENT" },
    });
    // ⚠ The code is wrong and it is the contract's, not a slip. `err` for this operation is
    // [PROJECT_ROLE_INSUFFICIENT, ORG_SCOPE_DENIED], while the precondition it enforces is
    // an ORG role (`orgRole = "admin"`). Reporting an org-layer refusal with a project-layer
    // code is exactly the confusion UC-0.3 R8 exists to prevent -- the user goes looking for
    // a project role. Emitted as written rather than invented around; reported in the F15
    // notes with the recommendation to add ORG_ROLE_INSUFFICIENT.
    throw new CapabilityDeniedError("PROJECT_ROLE_INSUFFICIENT");
  }

  if (op === "add") {
    const p = parse(AddPayload, input.payload);
    const row = await capabilities.insert(orgId, {
      kind,
      name: p.name,
      scope: p.scope,
      ownerTeamId: p.ownerTeamId ?? null,
      // F16: where it runs. In a personal-local organization migration 0012 refuses anything
      // but a loopback endpoint -- the admin gets a constraint violation rather than a row
      // that would have made the promise quietly untrue.
      endpoint: p.endpoint ?? null,
    });
    const listing = open(row, deps, membership);
    const provenanceEventId = await provenance.append({
      orgId,
      type: "capability-added",
      actorId,
      target: { kind: "capability", id: listing.id },
      // before/after, as V8 requires. `before: null` is the honest value for a creation and
      // is stated rather than omitted -- a missing key reads as "nobody recorded it".
      detail: { before: null, after: listing, kind, scope: p.scope },
    });
    // Nothing was running against a capability that did not exist a moment ago.
    return { listing, provenanceEventId, affectedInFlightCalls: 0 };
  }

  if (op === "update") {
    const p = parse(UpdatePayload, input.payload);
    const existing = await capabilities.findById(orgId, p.id);
    if (existing === null) throw new CapabilityNotFoundError();
    const before = open(existing, deps, membership);
    const updated = await capabilities.update(orgId, p.id, {
      name: p.name,
      scope: p.scope,
      ownerTeamId: p.ownerTeamId,
    });
    if (updated === null) throw new CapabilityNotFoundError();
    const listing = open(updated, deps, membership);
    const provenanceEventId = await provenance.append({
      orgId,
      type: "capability-updated",
      actorId,
      target: { kind: "capability", id: listing.id },
      detail: { before, after: listing, kind },
    });
    // Reported, not zeroed: calls already running were started against the OLD configuration,
    // so the dialog telling the admin how many is telling the truth about what changes under
    // them. Nothing is interrupted -- an update is not a disable.
    return {
      listing,
      provenanceEventId,
      affectedInFlightCalls: await inFlight.count(orgId, listing.id),
    };
  }

  const p = parse(DisablePayload, input.payload);
  const existing = await capabilities.findById(orgId, p.id);
  if (existing === null) throw new CapabilityNotFoundError();
  const before = open(existing, deps, membership);

  // D-U5: `interrupt` unless the caller asked for `drain`. The default is the safe-but-
  // annoying one, because only the other mistake is unsafe.
  const mode: DisableMode = input.disableMode ?? DEFAULT_DISABLE_MODE;

  // Counted BEFORE the mode is applied. Afterwards `interrupt` has already terminated them,
  // so a count taken then would be zero -- and the response would report that no call was
  // affected by the thing that just ended all of them.
  const affectedInFlightCalls = await inFlight.count(orgId, p.id);
  await inFlight.applyDisable(orgId, p.id, mode);

  const disabled = await capabilities.setEnabled(orgId, p.id, false);
  if (disabled === null) throw new CapabilityNotFoundError();
  const listing = open(disabled, deps, membership);

  const provenanceEventId = await provenance.append({
    orgId,
    type: "capability-disabled",
    actorId,
    target: { kind: "capability", id: listing.id },
    detail: { before, after: listing, kind, disableMode: mode, affectedInFlightCalls },
  });

  return { listing, provenanceEventId, affectedInFlightCalls };
}
