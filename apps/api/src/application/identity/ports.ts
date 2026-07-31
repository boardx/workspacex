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

/**
 * The object kinds `acl_bindings` can bind -- the same three the contract's
 * `authorize.in.object.kind` lists, and the same three that table's CHECK allows.
 */
export interface AclObjectRef {
  readonly kind: "project" | "artifact" | "segment";
  readonly id: string;
}

/**
 * Anything the guarded read path can wrap.
 *
 * ## Why `capability` is here but NOT in `AclObjectRef`
 *
 * A capability listing carries tenant data and a visibility scope, so it must travel through
 * `permission-filter` like everything else -- otherwise the admin console becomes a second
 * doorway to tenant rows and `lint-permission-paths` is right to refuse it.
 *
 * But its scope does NOT come from `acl_bindings`. That table binds CONTENT, and its I-1
 * trigger resolves each object against its organization through the content tables; a
 * capability has no such table and is not content -- it is the configuration that decides
 * what may act on content (F15). Its scope is a column on its own row, judged by
 * `decideCapabilityVisibility`, which feeds the SAME `decide()`.
 *
 * Splitting the two types is what makes that unbypassable in the type system: `authorize` /
 * `authorizeBatch` / `findBindings` take `AclObjectRef`, so handing them a capability is a
 * compile error rather than a lookup that finds no binding and quietly returns the
 * permissive default scope. Before the split, that silent path was the reachable one.
 */
export interface ObjectRef {
  /**
   * ⚠ `organization` added by F22, and it is in `ObjectRef` but NOT in `AclObjectRef` for
   * exactly the reason `capability` is: an organization's export is not gated by an
   * `acl_bindings` row. Handing one to `authorizeBatch` would find no binding, fall back to
   * the permissive default scope, and produce a normal-looking "allowed" for anybody in the
   * organization -- which is the opposite of "仅管理员可导出" (O-29 ③). Keeping it out of
   * `AclObjectRef` makes that a compile error instead of a silent grant; the rule that does
   * apply lives in `domain/auth/org-lifecycle.ts` and reaches the payload through
   * `discloseDecided`.
   */
  /**
   * ⚠ `interview` 由 F80 加入，理由与 `capability` / `organization` **完全同型**：
   * 一场访谈是租户内容（标题即内容），所以它必须走 `permission-filter` 这道唯一的门；
   * 但它的可见性**不来自 `acl_bindings`** —— 它是「创建者 + 显式协作者
   * （+ 项目非空时的项目成员）」两种投影，规则在 `domain/interview/scope.ts`。
   *
   * 把它排除在 `AclObjectRef` 之外，就是把「顺手交给 authorizeBatch 判一下」
   * 变成**编译错误**而不是一次找不到绑定、于是退回宽松默认 scope 的静默放行 ——
   * 对一场只有创建者能看的独立访谈，那种放行就是 I-31 被彻底作废。
   */
  /**
   * ⚠ `subject` 由 F97 加入，理由与 `interview` **完全同型**：一个访谈/观察对象是
   * 租户内容（联系方式、背景与要问什么均属未发布的研究意图），必须走
   * `permission-filter`；但它同样**没有 `acl_bindings` 行**——可见性规则在
   * `domain/interview/subject-visibility.ts`（创建者 + 本组所属项目的非观察者成员）。
   *
   * 排除在 `AclObjectRef` 之外的理由不变：不这样做，`authorizeBatch` 会对一个
   * 没有绑定行的对象找不到绑定、退回宽松默认 scope，让**观察者也能读对象表**——
   * 这正是 R5「观察者不可读对象表」被作废的样子。
   */
  readonly kind: AclObjectRef["kind"] | "capability" | "organization" | "interview" | "subject";
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
  findBindings(orgId: OrgId, objects: readonly AclObjectRef[]): Promise<Map<string, BindingRow>>;
  /** Organizations this user belongs to -- used by SwitchOrganization's membership check */
  listMemberships(userId: string): Promise<readonly { orgId: string; orgRole: OrgRole }[]>;

  /* ───────────────────────── F16: the personal-local organization ───────────────────────── */

  /**
   * Create this user's personal-local organization, or return the existing one (I-2).
   *
   * ⚠ Idempotent by UNIQUE INDEX, not by check-then-insert -- see
   * `application/identity/personal-local-org.ts`. The signature returns the organization
   * rather than a boolean "created" flag on purpose: a caller that branches on "did I create
   * it" is a caller that will eventually do something only on first creation, and first
   * creation is not observable under a retry.
   */
  ensurePersonalLocalOrg(userId: string, displayName: string): Promise<OrganizationRow>;

  /**
   * This user's own local organization.
   *
   * ⚠ Takes a userId and NOT an orgId. There is no "find the local org with this id" method
   * anywhere in this port, so no use case can be written that reaches another person's local
   * organization by id -- the isolation is a shape rather than a check.
   */
  findPersonalLocalOrg(userId: string): Promise<OrganizationRow | null>;

  /** How many members an organization has. For a personal-local org this is I-3's assertion. */
  countOrgMembers(orgId: OrgId): Promise<number>;
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
