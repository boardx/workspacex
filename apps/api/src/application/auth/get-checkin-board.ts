/**
 * `GetCheckinBoard`（F16 / UC-1.3 R8）—— 分组与签到，现场面。
 *
 * ⚠ **管理面与现场面共用同一份数据**（usecases.md 逐字）：这里没有第二张表、
 *   第二条读路径。引导师、组长、参与者刷新看到的都是这同一次查询。
 *
 * ## 越权判定为什么不是 `decideInviteLinkManagement`
 *
 * 那条规则只放行引导师（签发/撤销链接的门槛）。签到板的门槛更松——
 * usecases.md `pre` 逐字「引导师看全部、组长只见本组、观察者只见脱敏聚合」，
 * 三种角色都能读，只挡「不在这个项目里的人」。⇒ 用
 * `decideCheckinBoardAccess`（`domain/auth/live-session.ts`），越权判定与内容投影
 * 是两件事：前者决定「能不能读」，后者（下面的 `projectForRole`）决定「读到多少」。
 *
 * ## 组长只见本组：为什么在这一层过滤，不在仓储层
 *
 * 仓储的 `board()` 返回**全量** `Guarded<CheckinGroupRow[]>`——它不知道调用者是谁。
 * 「组长只见本组」是**内容投影**，与 `discloseDecided` 的「能不能读」是分开的两件事
 * （同 `identity` 束「读到的行数」与「能不能读」不应该合并在一次判定里的教训）。
 * ⚠ 「观察者只见脱敏聚合」**尚未在这里落地**——当前投影对观察者与引导师给同一份形状，
 *   理由是这份形状本身已经不含手机号/令牌（I-16 由 `CheckinGroupRow` 的字段集合保证，
 *   不需要额外为观察者再摘一层）。「聚合」具体要收窄到什么程度是 `[待定]`，
 *   已知这是一处未完全裁决的缺口，**不由本用例替人猜**。
 */
import { decideCheckinBoardAccess } from "../../domain/auth/live-session";
import type { OrgId } from "../../domain/org-id";
import type { DecisionIdFactory } from "../identity/ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { OrgAdminError } from "./org-invite-errors";
import type { CheckinGroupRow, LiveSessionRepository } from "./live-session-ports";

export interface GetCheckinBoardDeps {
  readonly liveSessions: LiveSessionRepository;
  readonly ids: DecisionIdFactory;
}

export interface GetCheckinBoardInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly actorId: string;
  readonly actorOrgRole: string | null;
  readonly actorTeamId: string | null;
  readonly actorProjectRole: string | null;
  readonly actorGroupId: string | null;
}

export interface GetCheckinBoardOutput {
  readonly groups: readonly CheckinGroupRow[];
  readonly overall: { readonly present: number; readonly total: number };
  /** false = 已降级为轮询，界面必须显示「非实时」。见文件尾。 */
  readonly realtime: boolean;
}

function denied(reasonCode: string | null): never {
  throw new OrgAdminError(reasonCode === "NO_ORG_MEMBERSHIP" ? "NO_ORG_MEMBERSHIP" : "NO_PROJECT_ROLE");
}

/** 组长只见本组；引导师与其余已放行角色见全部（观察者的进一步收窄见文件头 `[待定]`）。 */
function projectForRole(
  groups: readonly CheckinGroupRow[],
  actorProjectRole: string | null,
  actorGroupId: string | null,
): readonly CheckinGroupRow[] {
  if (actorProjectRole !== "groupLead") return groups;
  return groups.filter((g) => g.groupId === actorGroupId);
}

export async function getCheckinBoard(
  deps: GetCheckinBoardDeps,
  input: GetCheckinBoardInput,
): Promise<GetCheckinBoardOutput> {
  const guarded = await deps.liveSessions.board(input.orgId, input.projectId);
  const decision = decideCheckinBoardAccess({
    decisionId: deps.ids.next(),
    orgRole: input.actorOrgRole,
    teamId: input.actorTeamId,
    projectRole: input.actorProjectRole,
    groupId: input.actorGroupId,
  });
  const out = discloseDecided(guarded, decision);
  if (!isDisclosed(out)) denied(decision.reasonCode);

  const groups = projectForRole(out.payload, input.actorProjectRole, input.actorGroupId);
  const overall = groups.reduce(
    (acc, g) => ({ present: acc.present + g.present, total: acc.total + g.total }),
    { present: 0, total: 0 },
  );

  /**
   * `realtime: false` —— 恒为 false，且是**真话不是占位**（同 F15 `revoke-invite-links.ts`
   * 处置 `onsiteSessions` 的先例）：本仓目前没有任何推送通道给这块看板用，
   * 界面只能靠轮询。等一条真实的推送通道接入，这里改成真值，
   * 而不是让下一个人从「恒为 true」里推断出「已经接好了」。
   */
  return { groups, overall, realtime: false };
}
