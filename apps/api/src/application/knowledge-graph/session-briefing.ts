/**
 * issue #4362（S5）—— 新个人对话的开场简报（读）、关掉 / 重新打开（本人偏好）、埋点（展示 / 采纳 / 关闭）。
 *
 * 只读查看者本人的个人空间：读口按本人 id 取、结果包在本人个人空间的 guard 里，这里交出与 getPersonalKnowledge
 * 同一个判定（decidePersonalSpace：本组织成员 且 空间主人 = 查看者）才拿得到——别人的空间、项目会话的知识进不来。
 * 偏好与埋点只写本人自己的一行（表的 RLS 也只放 user_id = 登录用户）。
 * 关掉了 ⇒ 不读材料，直接回 `{ dismissed: true, items: [] }`（关掉就不该再为它花一次查询）。
 */
import type { knowledgeGraph as KG } from "@repo/contracts";
import { composeBriefing } from "../../domain/knowledge-graph/briefing";
import type { OrgId } from "../../domain/org-id";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { requireOwnPersonalSpace } from "./profile";
import type { SessionBriefingPort } from "./profile-ports";
import { decidePersonalSpace } from "./read-personal-knowledge";
import { KgReadError, type KnowledgeReadDeps } from "./read-thread-knowledge";

interface Viewer {
  readonly userId: string;
  readonly orgId: OrgId;
}
type Deps = KnowledgeReadDeps & { readonly briefing: SessionBriefingPort };

export async function getSessionBriefing(deps: Deps, input: Viewer): Promise<KG.KgSessionBriefing> {
  await requireOwnPersonalSpace(deps, input);
  if (await deps.briefing.dismissed(input.orgId, input.userId)) return { dismissed: true, items: [] };
  const guarded = await deps.briefing.sources(input.orgId, input.userId);
  const d = discloseDecided(guarded, await decidePersonalSpace(deps, input, guarded));
  if (!isDisclosed(d)) throw new KgReadError("KG_NOT_VISIBLE");
  return { dismissed: false, items: composeBriefing(d.payload) };
}

export async function setSessionBriefingPreference(deps: Deps, input: Viewer & { readonly dismissed: boolean }): Promise<{ readonly dismissed: boolean }> {
  await requireOwnPersonalSpace(deps, input);
  return { dismissed: await deps.briefing.setDismissed(input.orgId, input.userId, input.dismissed) };
}

export async function recordSessionBriefingEvent(
  deps: Deps,
  input: Viewer & { readonly event: KG.KgBriefingEvent; readonly itemIds: readonly string[] },
): Promise<{ readonly recorded: true }> {
  await requireOwnPersonalSpace(deps, input);
  await deps.briefing.recordEvent(input.orgId, input.userId, input.event, input.itemIds);
  return { recorded: true };
}
