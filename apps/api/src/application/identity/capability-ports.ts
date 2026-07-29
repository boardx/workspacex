/**
 * Ports for the capability listing (F15). Defined here, implemented by `infrastructure`.
 *
 * ## Why a listing comes back in two pieces
 *
 * `CapabilityScopeFacts` is what the DECISION is made from; `Guarded<CapabilityListing>` is
 * what may be shown once the decision allows it. Same split as `PgContentRepository`'s
 * `findItemFacts` / `findItemBody`, and for the same reason: a single row object is how a
 * field ends up in a response that only ever wanted a verdict.
 *
 * It is also forced by a gap in the contract. `CapabilityListing` carries
 * `scope: "team-only"` but no field saying WHICH team -- so the owning team cannot be part
 * of the disclosed listing even though the decision cannot be made without it. Reported in
 * the F15 notes rather than fixed by inventing a field.
 */
import type { CapabilityKind, CapabilityListing, DisableMode } from "../../domain/identity/capability-listing";
import type { VisibilityScope } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

/** What `decideCapabilityVisibility` needs. Never disclosed; never part of a response. */
export interface CapabilityScopeFacts {
  readonly id: string;
  readonly scope: VisibilityScope;
  /** Which team owns a team-only capability. Meaningless for org-wide. */
  readonly ownerTeamId: string | null;
  /**
   * Where this capability runs (F16 contract revision). A FACT, not part of the disclosure:
   * `invokeLocalModel` has to know it BEFORE deciding whether the call may happen at all, and
   * a value you must read in order to decide cannot live behind the decision.
   *
   * `null` for kinds that do not run anywhere remote (skill / canvas-template / blueprint).
   */
  readonly endpoint: string | null;
}

export interface GuardedCapability {
  readonly facts: CapabilityScopeFacts;
  readonly listing: Guarded<CapabilityListing>;
}

/**
 * No `id`: the implementation mints it.
 *
 * A capability id never comes from the caller. `capability_listings.id` is a primary key
 * that provenance events point at, and an id the admin console could choose is an id two
 * organizations could choose identically -- at which point an audit query for "who disabled
 * cap-ledger" spans tenants.
 */
export interface CapabilityInsert {
  readonly kind: CapabilityKind;
  readonly name: string;
  readonly scope: VisibilityScope;
  readonly ownerTeamId: string | null;
  readonly endpoint: string | null;
}

export interface CapabilityPatch {
  readonly name?: string;
  readonly scope?: VisibilityScope;
  readonly ownerTeamId?: string | null;
  readonly endpoint?: string | null;
}

/**
 * ⚠ There is no `list()` that takes no organization, and no `delete()`.
 *
 * The first absence is tenancy: every read is scoped to one organization, so "give me all
 * capabilities" is not a question this port can be asked. The second is D-U5: retiring a
 * capability is a DISABLE with a chosen interruption mode and a provenance row. A delete
 * would be the same intent with neither, and it would orphan the audit events that name the
 * row. The database agrees -- migration 0008 grants no DELETE.
 */
export interface CapabilityRepository {
  listByKind(orgId: OrgId, kind: CapabilityKind): Promise<readonly GuardedCapability[]>;
  /** Every kind, for `SwitchOrganization`: the whole configuration changes at once (R3 5). */
  listAll(orgId: OrgId): Promise<readonly GuardedCapability[]>;
  findById(orgId: OrgId, id: string): Promise<GuardedCapability | null>;
  insert(orgId: OrgId, row: CapabilityInsert): Promise<GuardedCapability>;
  update(orgId: OrgId, id: string, patch: CapabilityPatch): Promise<GuardedCapability | null>;
  setEnabled(orgId: OrgId, id: string, enabled: boolean): Promise<GuardedCapability | null>;
}

export const CAPABILITY_REPOSITORY = Symbol("CapabilityRepository");

/**
 * In-flight model / tool calls per capability (D-U5).
 *
 * ## Why this is a port and not a counter someone increments later
 *
 * `affectedInFlightCalls` is stated in the contract to be PART OF THE CONTRACT, not
 * telemetry: the confirmation dialog reads "N in-flight calls will be interrupted", and an
 * admin deciding between `interrupt` and `drain` is deciding on the strength of that number.
 * A number that is always zero because nothing ever reports one is a dialog that lies.
 *
 * ⚠ Stated plainly: phase-00 has no agent runtime, so in production NOTHING calls `begin()`
 * yet and the count is genuinely zero. What exists is the whole path -- registry to use case
 * to response -- asserted in BOTH directions (zero when nothing runs, N when N are
 * registered), so the runtime that arrives in phase-01 has one place to report into rather
 * than a field to go and invent.
 *
 * `admits()` is what makes the two modes differ observably: after either mode the capability
 * stops admitting new calls; after `interrupt` the running ones are terminated too, and after
 * `drain` they are not.
 */
export interface InFlightCallRegistry {
  /** How many calls are running against this capability right now. */
  count(orgId: OrgId, capabilityId: string): Promise<number>;
  /** Apply D-U5. Returns how many in-flight calls were affected. */
  applyDisable(orgId: OrgId, capabilityId: string, mode: DisableMode): Promise<number>;
  /** May a NEW call start? False once the capability has been disabled either way. */
  admits(orgId: OrgId, capabilityId: string): Promise<boolean>;
}

export const IN_FLIGHT_CALLS = Symbol("InFlightCallRegistry");
