/**
 * `TeamRepository` —— F11（O-29 ④）的唯一持久化端口。
 *
 * ## 为什么 create / rename / delete 是**一个方法**而不是三个
 *
 * usecases.md `MutateTeam` 的 `in` 本身就是「一个操作三个分支」（契约 `TeamOp`），
 * 而不是三条路由——原文：「删除要做占用校验（I-7），不是三条独立路由」。
 * 把它拆成三个仓储方法只是把同一个决定往下挪了一层，并不会让哪一分支变得更简单，
 * 反而让「三个分支共用同一把 `orgId` 租户锁」这件事需要在调用方重新拼一次。
 */
import type { OrgId } from "../../domain/org-id";

export interface TeamRow {
  readonly teamId: string;
  readonly name: string;
}

/** `listTeams`（#639 delta，迭代 1）一行。`memberCount` 现查，不额外维护计数列。 */
export interface TeamListRow extends TeamRow {
  readonly memberCount: number;
}

/** 删除被阻断时的占用项。⚠ **不得为空数组**——空数组等于没说明原因（契约 `mutateTeam.out.blocked`）。 */
export interface TeamOccupancyItem {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
}

export interface TeamOccupancy {
  readonly memberCount: number;
  readonly aclBindingCount: number;
  readonly items: readonly TeamOccupancyItem[];
}

export type MutateTeamResult =
  | { readonly ok: true; readonly team: TeamRow | null }
  | { readonly ok: false; readonly reason: "in-use"; readonly occupancy: TeamOccupancy }
  /**
   * `not-found`：`rename` / `delete` 指向一个不存在（或已被并发删除）的 `teamId`。
   *
   * ⚠ 契约 `mutateTeam.err` 里没有专属的「团队不存在」码——`usecases.md` 只列了
   * `TEAM_IN_USE` / `PROJECT_ROLE_INSUFFICIENT` / `VERSION_CHANGED` / `AUTH_SERVICE_UNAVAILABLE`，
   * 而 `in` 也没有版本字段可供「乐观并发」比对。⇒ 本实现把「目标不存在」映射为
   * `VERSION_CHANGED`（「两名管理员同时改同一团队，其中一个已经把它改没了」是这个码
   * 最贴切的既有语义），而不是发明一个契约里没有的码。这是一次**裁定**，记在这里
   * 而不是留给下一个人重新猜——需要专属码时那是人裁，不是 agent 裁。
   */
  | { readonly ok: false; readonly reason: "not-found" };

export interface TeamRepository {
  /**
   * `create` —— O-29 ④「组织内名称唯一」；同名重复提交是**幂等重放**：返回既有 team，
   * 不建第二行（usecases.md 逐字）。
   */
  create(orgId: OrgId, name: string): Promise<MutateTeamResult>;

  /** `rename` —— **不改 id**；已有 `acl_binding` 绑定不受影响（team-only 引用的是 id 不是 name）。 */
  rename(orgId: OrgId, teamId: string, name: string): Promise<MutateTeamResult>;

  /**
   * `delete` —— 删除前占用校验（I-7）：任何 `org_memberships.team_id` 或
   * `acl_bindings.owner_team_id` 指向它，一律阻断并**列出占用项**，**不做级联删除**。
   */
  delete(orgId: OrgId, teamId: string): Promise<MutateTeamResult>;

  /**
   * `list` —— 只读列表（#639 delta，迭代 1）。`memberCount` 必须是
   * `COUNT(*) FROM org_memberships WHERE team_id = $1` 的真查询，不是硬编码 0——
   * 这条是反证 C 的断言对象。
   */
  list(orgId: OrgId): Promise<readonly TeamListRow[]>;
}

export const TEAM_REPOSITORY = Symbol("TeamRepository");
