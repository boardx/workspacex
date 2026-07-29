/**
 * Ports for the identity use cases. Defined here, implemented by `infrastructure`.
 *
 * Note the batch shapes. `authorizeBatch` exists because retrieval judges dozens to
 * hundreds of segments at a time, and per-item round trips would make the correct path the
 * slow one -- at which point somebody writes their own coarse filter and R7 is hollow.
 * The port has to make the batch path natural, or the use case cannot deliver on it.
 */
import { identity } from "@repo/contracts";
import type { z } from "zod";
import type { OrgRole, ProjectRole, VisibilityScope } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";

export interface OrgMembershipRow {
  readonly orgRole: OrgRole;
  readonly teamId: string | null;
}

export interface ProjectMembershipRow {
  readonly projectRole: ProjectRole;
  readonly groupId: string | null;
  readonly isHost: boolean;
}

export interface ObjectRef {
  readonly kind: "project" | "artifact" | "segment";
  readonly id: string;
}

export interface BindingRow {
  readonly scope: VisibilityScope;
  readonly ownerTeamId: string | null;
}

/**
 * The organization as the API returns it.
 *
 * DERIVED from the contract, not restated. The first version of this file declared its own
 * shape and drifted immediately: it had no `team` field, so `/identity/me` would have
 * returned a body the contract does not describe -- and nothing would have failed, because
 * request bodies are validated and responses were not. `contract-response.test.ts` closes
 * that half.
 */
export type OrganizationRow = z.infer<typeof identity.Organization>;

export interface IdentityRepository {
  findOrganization(orgId: OrgId): Promise<OrganizationRow | null>;
  findOrgMembership(userId: string, orgId: OrgId): Promise<OrgMembershipRow | null>;
  findProjectMembership(userId: string, projectId: string, orgId: OrgId): Promise<ProjectMembershipRow | null>;
  /**
   * Bindings for many objects in ONE round trip. Returns a map keyed by `kind:id`;
   * objects with no binding are simply absent.
   */
  findBindings(orgId: OrgId, objects: readonly ObjectRef[]): Promise<Map<string, BindingRow>>;
  /** Organizations this user belongs to -- used by SwitchOrganization's membership check */
  listMemberships(userId: string): Promise<readonly { orgId: string; orgRole: OrgRole }[]>;
}

export const IDENTITY_REPOSITORY = Symbol("IdentityRepository");

/**
 * Session context. Its existence is a CONTRACT obligation, not an implementation detail:
 * switchOrganization's documented post-effects say the project-scoped context is cleared
 * and permissions are re-evaluated (O-12). Without somewhere to hold that context, "it was
 * cleared" is unassertable, and an unassertable requirement is one that quietly stops being
 * true.
 */
export interface SessionContext {
  readonly currentOrgId: string | null;
  readonly currentProjectId: string | null;
  readonly currentStageId: string | null;
  readonly contextPackId: string | null;
  readonly draftRefs: readonly string[];
}

export interface SessionStore {
  get(userId: string): Promise<SessionContext>;
  setOrg(userId: string, orgId: string): Promise<void>;
  setProjectScoped(userId: string, patch: Partial<SessionContext>): Promise<void>;
  /** Everything project-scoped, gone. Org membership itself is not project-scoped. */
  clearProjectScoped(userId: string): Promise<void>;
}

export const SESSION_STORE = Symbol("SessionStore");

/**
 * Authorization decision cache.
 *
 * It is a port rather than an internal detail for one reason: O-12 requires that switching
 * organizations reuses NO prior judgement. A cache nobody can reach is a cache nobody can
 * prove was invalidated -- and stale authorization is the failure mode where the user keeps
 * seeing the previous organization's data and everything looks normal.
 */
export interface AuthorizationCache {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  invalidateUser(userId: string): Promise<void>;
  size(userId: string): Promise<number>;
}

export const AUTHORIZATION_CACHE = Symbol("AuthorizationCache");

/** Generates decisionIds. A port so the domain stays pure and tests stay deterministic. */
export interface DecisionIdFactory {
  next(): string;
}

export const DECISION_ID_FACTORY = Symbol("DecisionIdFactory");
