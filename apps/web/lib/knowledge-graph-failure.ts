/**
 * phase-18 F10 —— 「记忆」编辑动作失败时给人看的话。
 *
 * 契约错误码 `KgErrorCode` 是闭集，这里逐个写一句人话（`Record<KgErrorCode, string>`：漏配一个
 * 编译就不过）。内部码**不上屏**（`lint:user-facing-error-text`）；不是本束可识别的失败（网络断、
 * 网关、服务端 `KG_INVALID_REQUEST` 这类契约外的码）一律给通用说法，不猜。
 * 用词守 `requirements/06-user-experience.md` R5：说「记忆 / 这一条 / 人和事」，不说内部术语。
 */
import type { KnowledgeGraphErrorCode } from "@/lib/knowledge-graph-api";
import { knowledgeGraphErrorCode } from "@/lib/knowledge-graph-api";

const HUMAN_ACTION_FAILURE_ZH: Record<KnowledgeGraphErrorCode, string> = {
  KG_THREAD_NOT_FOUND: "这条对话不存在或已被删除。",
  KG_NOT_VISIBLE: "你没有这条对话的访问权限。",
  KG_NOT_OWNER: "只有对话的创建者可以修改这里的记忆。",
  KG_REVISION_CHANGED: "内容已变化，已为你刷新到最新，请再操作一次。",
  KG_CLAIM_NOT_FOUND: "这一条已经不在了，已为你刷新列表。",
  KG_OBJECT_NOT_FOUND: "相关的人和事已经不在了，已为你刷新列表。",
  KG_CONTESTED_NEEDS_RESOLUTION: "有矛盾的记忆要先选保留哪条，才能确认。",
  KG_ACTOR_NOT_HUMAN: "这个操作只能由你本人在界面上完成。",
  KG_SCOPE_NOT_PERSONAL: "只有个人对话里的记忆可以这样做。",
  KG_SCOPE_NOT_ENABLED: "这个范围的记忆暂未开放。",
  KG_EVIDENCE_REVOKED: "这一条的来源已被删除，没法再这样做。",
  KG_PROMOTE_BATCH_TOO_LARGE: "一次选得太多了，请分几次操作。",
  KG_REINDEX_ALREADY_RUNNING: "正在整理中，请稍后再试。",
  KG_CARD_NOT_FOUND: "这张卡片已经不在了。",
  KG_CARD_STALE: "这张卡片已过期，请刷新后再试。",
  KG_PROMPT_NOT_FOUND: "这条提醒已经不在了。",
};

/** 失败后应当重读面板的码：服务端状态已与界面不一致。 */
export const KG_RELOAD_ON_FAILURE: ReadonlySet<KnowledgeGraphErrorCode> = new Set([
  "KG_REVISION_CHANGED",
  "KG_CLAIM_NOT_FOUND",
  "KG_OBJECT_NOT_FOUND",
]);

export function describeHumanActionFailure(e: unknown): string {
  const code = knowledgeGraphErrorCode(e);
  return code === null ? "没能保存这次修改，请稍后重试。" : HUMAN_ACTION_FAILURE_ZH[code];
}
