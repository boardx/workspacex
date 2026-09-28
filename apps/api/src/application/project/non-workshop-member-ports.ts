/**
 * 项目中枢 B3-T5（#4499）—— 研究项目 / 用户洞察两类容器成员表的仓储端口。
 *
 * ⚠ **故意不是 `ProjectMembershipRepository`（F125）的又一组方法**：那边写的是 `project_memberships`
 *   （工作坊四角色 + host + 分组），这边是 `research_project_members` / `user_insight_members`
 *   （两档、无 host、无分组、按 `projects.kind` 分派到两张表）。形状不同、表不同、判定不同，
 *   混进同一个接口只会让互不相关的断言绑在一起（同 `member-ports.ts` 文件头对 F117/F124 的理由）。
 *
 * ## 名单读侧交 `Guarded<T>`
 *
 * 披露由用例拿 `decideNonWorkshopMemberAccess()` 的决策解开（`discloseDecided`）。判定需要的
 * 「调用者在名单上是什么档 / 名单里有没有 owner」走 `findStanding`——它返回的是**身份数据**
 * （同 `IdentityRepository.findProjectMembership` 的性质），不是名单内容，所以不 guard；
 * 名单本身（谁在、叫什么）才是内容。
 *
 * ## `upsert` 而不是 `add` + `change` 两个方法
 *
 * 契约 `addNonWorkshopMember` 头注：一人一行，再 add 一次 = 改档。两档没有单独的 change 操作，
 * 拆成两个方法反而要在用例里先查后写。归档判定同 `pg-project-membership-repository.ts`：
 * INSERT/UPDATE 撞 F124 RESTRICTIVE 策略抛 42501 ⇒ `archived`；DELETE 的策略挂 `USING` 静默过滤，
 * 所以用例在 remove 之前先读 `findContainer().status`。
 */
import type { OrgId } from "../../domain/org-id";
import type { ProjectKind } from "../../domain/project/create-project-rules";
import type { NonWorkshopMemberRole } from "../../domain/project/non-workshop-member-access";
import type { Guarded } from "../security/permission-filter";

export type { NonWorkshopMemberRole };

/** 本端口只对这两类容器有意义；`workshop` 在用例层被挡成 400（契约 `listNonWorkshopMembers` 头注）。 */
export type NonWorkshopKind = Exclude<ProjectKind, "workshop">;

export interface NonWorkshopContainer {
  readonly kind: ProjectKind;
  readonly status: "active" | "archived";
}

/** 与契约 `NonWorkshopMemberEntry` 逐字同名同型。 */
export interface NonWorkshopMemberRow {
  readonly userId: string;
  readonly displayName: string;
  readonly role: NonWorkshopMemberRole;
}

export interface NonWorkshopStanding {
  /** 调用者在名单上的档位；`null` = 不在名单上。 */
  readonly memberRole: NonWorkshopMemberRole | null;
  /** 名单里是否已有至少一名 owner。 */
  readonly containerHasOwner: boolean;
}

export type UpsertNonWorkshopMemberOutcome =
  | { readonly kind: "written"; readonly role: NonWorkshopMemberRole }
  /** 容器（或其子类型行）不存在——外键冲突 23503。用例映成 NO_PROJECT_ROLE。 */
  | { readonly kind: "not-found" }
  /** F124 归档冻结策略拒写（42501）。 */
  | { readonly kind: "archived" };

export type RemoveNonWorkshopMemberOutcome = "removed" | "absent";

export interface NonWorkshopMemberRepository {
  /** `null` = 容器不存在（或不在这个组织）。返回 `kind` 让用例判 workshop ⇒ 400。 */
  findContainer(orgId: OrgId, projectId: string): Promise<NonWorkshopContainer | null>;
  findStanding(orgId: OrgId, projectId: string, kind: NonWorkshopKind, userId: string): Promise<NonWorkshopStanding>;
  /** owner 在前、再按 userId；`displayName` LEFT JOIN `credentials`，缺则回落 userId。 */
  listMembers(orgId: OrgId, projectId: string, kind: NonWorkshopKind): Promise<Guarded<readonly NonWorkshopMemberRow[]>>;
  upsertMember(cmd: {
    readonly orgId: OrgId;
    readonly projectId: string;
    readonly kind: NonWorkshopKind;
    readonly userId: string;
    readonly role: NonWorkshopMemberRole;
  }): Promise<UpsertNonWorkshopMemberOutcome>;
  removeMember(cmd: {
    readonly orgId: OrgId;
    readonly projectId: string;
    readonly kind: NonWorkshopKind;
    readonly userId: string;
  }): Promise<RemoveNonWorkshopMemberOutcome>;
}

export const NON_WORKSHOP_MEMBER_REPOSITORY = Symbol("NonWorkshopMemberRepository");
