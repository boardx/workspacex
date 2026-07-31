/**
 * 管理面读：链接清单（含**使用者记录**）与名单条目。
 *
 * ## 为什么这一条必须存在，而不是「等界面来了再说」
 *
 * F15 的 `user_visible_behavior` 里有「`invite_link.used_by` 记录使用者与时间」。
 * 只写一列没人读得出来，等于没记：`used_by` 可以从头到尾是 NULL 而全部写路径都绿。
 * ⇒ 「能查出**是谁用的哪一条**」是这个用例，`invite-onetime-used-by.test.ts` 断言它。
 *
 * ⚠ 「呈现位置」（名单行内 / 链接卡片下 / 只落审计流水）是 domain.md `[待定 E]`，
 *   **未裁决**，而且它只影响界面、不影响数据模型（O-06 已闭合落点）。
 *   这里给的是**数据**，不是那个裁决。
 *
 * ## 为什么走 `discloseDecided` 而不是 `disclose`
 *
 * 与 `exportOrganization` 同型：一条邀请链接没有 `acl_bindings` 行，`authorize` 找不到绑定
 * 就退回宽松默认 scope，看见非空的组织角色，于是给**组织里的每一个人**放行——
 * 包括根本不在这个项目里的顾问，而清单里带着令牌明文。规则在 domain
 * （`decideInviteLinkManagement`），载荷经 `discloseDecided` 取出。
 */
import { decideInviteLinkManagement } from "../../domain/auth/invite-link";
import type { OrgId } from "../../domain/org-id";
import type { DecisionIdFactory } from "../identity/ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { OrgAdminError } from "./org-invite-errors";
import type {
  InviteLinkRepository,
  InviteLinkRow,
  ParticipantRosterRepository,
  ParticipantRow,
} from "./invite-link-ports";

export interface ListInviteLinksDeps {
  readonly repo: InviteLinkRepository;
  readonly ids: DecisionIdFactory;
}

export interface ListInviteLinksInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly actorId: string;
  readonly actorOrgRole: string | null;
  readonly actorTeamId: string | null;
  readonly actorProjectRole: string | null;
  readonly actorGroupId: string | null;
}

function decisionFor(deps: { ids: DecisionIdFactory }, input: ListInviteLinksInput) {
  return decideInviteLinkManagement({
    decisionId: deps.ids.next(),
    orgRole: input.actorOrgRole,
    teamId: input.actorTeamId,
    projectRole: input.actorProjectRole,
    groupId: input.actorGroupId,
  });
}

/** 拒绝时把 domain 的 reasonCode 原样变成契约里的码——不在这里重新发明一遍。 */
function denied(reasonCode: string | null): never {
  throw new OrgAdminError(
    reasonCode === "NO_ORG_MEMBERSHIP"
      ? "NO_ORG_MEMBERSHIP"
      : reasonCode === "PROJECT_ROLE_INSUFFICIENT"
        ? "PROJECT_ROLE_INSUFFICIENT"
        : "NO_PROJECT_ROLE",
  );
}

export async function listInviteLinks(
  deps: ListInviteLinksDeps,
  input: ListInviteLinksInput,
): Promise<readonly InviteLinkRow[]> {
  const guarded = await deps.repo.list(input.orgId, input.projectId);
  const decision = decisionFor(deps, input);
  const out = discloseDecided(guarded, decision);
  if (!isDisclosed(out)) denied(decision.reasonCode);
  return out.payload;
}

export interface ListRosterDeps {
  readonly roster: ParticipantRosterRepository;
  readonly ids: DecisionIdFactory;
}

export async function listParticipantRoster(
  deps: ListRosterDeps,
  input: ListInviteLinksInput,
): Promise<readonly ParticipantRow[]> {
  const guarded = await deps.roster.list(input.orgId, input.projectId);
  const decision = decisionFor(deps, input);
  const out = discloseDecided(guarded, decision);
  if (!isDisclosed(out)) denied(decision.reasonCode);
  return out.payload;
}

/**
 * 「9 / 12 已确认」的两个数。
 *
 * ⚠ 分子分母都从**同一次读**里算，不是两次 count。两次 count 之间有人进场，
 *   界面上会出现 `13 / 12`——而那正是「随邀请与进场实时刷新」这句话最容易翻车的地方。
 */
export function confirmedCounts(rows: readonly ParticipantRow[]): {
  readonly confirmed: number;
  readonly total: number;
} {
  return { confirmed: rows.filter((r) => r.confirmState === "confirmed").length, total: rows.length };
}
