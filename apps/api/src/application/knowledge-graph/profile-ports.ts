/**
 * issue #4360 / #4362（S5）——「关于我」画像与开场简报的端口。单独一个文件（不往 ports.ts 里堆）：
 * 这些端口只被 profile.ts / session-briefing.ts / 抽取任务的挂目标一步用到，与召回、面板的端口互不相干。
 */
import type { BriefingSources } from "../../domain/knowledge-graph/briefing";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";
import type { knowledgeGraph as KG } from "@repo/contracts";

type KgClaimKind = KG.KgClaimKind;

/** 数据库里的挂目标 / 改写入口（迁移 20260928210000）。实现只调函数，不写表名 SQL。 */
export interface GoalLinkPort {
  /** 系统读：这条消息刚记进作者本人个人空间、还没挂过目标的决定 / 待办，以及作者本人的目标。作者由证据消息推出。 */
  candidates(orgId: OrgId, threadId: string, messageId: string): Promise<{
    readonly author: string | null;
    readonly items: readonly { readonly id: string; readonly statement: string; readonly kind: KgClaimKind }[];
    readonly goals: readonly { readonly id: string; readonly statement: string }[];
  }>;
  /**
   * 挂 / 改挂 / 摘掉。`actor.kind = "system"` ⇒ 不声明登录用户，数据库按 thread + message 推出作者、只挂从没挂过的；
   * `"human"` ⇒ 声明 app.current_user_id，只在本人的个人空间里动。
   */
  set(orgId: OrgId, actor: { readonly kind: "system"; readonly threadId: string; readonly messageId: string } | { readonly kind: "human"; readonly userId: string }, input: {
    readonly actionId: string; readonly claimId: string; readonly goalClaimId: string | null; readonly confidence?: number;
  }): Promise<{ readonly claimId: string; readonly goalClaimId: string | null; readonly outcome: "linked" | "unlinked" | "unchanged" }>;
  /** 人：改写本人个人空间的一条，返回新一条的 id。 */
  revise(orgId: OrgId, userId: string, input: { readonly actionId: string; readonly claimId: string; readonly statement: string }): Promise<string>;
}
export const KG_GOAL_LINK_PORT = Symbol("KgGoalLinkPort");

/** 模型对「这条决定 / 待办为哪个目标服务」的提议。goalKey 是本次调用里给目标编的短号（g1、g2…），不是库里的 id。 */
export interface GoalLinkProposal {
  readonly goalKey: string | null;
  readonly confidence: number;
}
export interface GoalLinkProposerPort {
  /** 读不懂模型的回复 ⇒ null（当作没有提议，不猜）。 */
  propose(input: {
    readonly item: { readonly statement: string; readonly kind: KgClaimKind };
    readonly goals: readonly { readonly key: string; readonly statement: string }[];
  }): Promise<GoalLinkProposal | null>;
}
export const KG_GOAL_LINK_PROPOSER_PORT = Symbol("KgGoalLinkProposerPort");

/** 开场简报的读（按本人读、包进个人空间的 guard）与本人偏好 / 埋点的写。 */
export interface SessionBriefingPort {
  sources(orgId: OrgId, userId: string): Promise<Guarded<BriefingSources>>;
  dismissed(orgId: OrgId, userId: string): Promise<boolean>;
  setDismissed(orgId: OrgId, userId: string, dismissed: boolean): Promise<boolean>;
  recordEvent(orgId: OrgId, userId: string, event: "shown" | "accepted" | "dismissed", itemIds: readonly string[]): Promise<void>;
}
export const KG_SESSION_BRIEFING_PORT = Symbol("KgSessionBriefingPort");
