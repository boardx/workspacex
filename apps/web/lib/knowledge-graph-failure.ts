import type { Locale } from "@/lib/i18n/locale";
import { translate, type MessageKey } from "@/lib/i18n/messages";
/**
 * phase-18 F10 —— 「记忆」编辑动作失败时给人看的话。
 *
 * 契约错误码 `KgErrorCode` 是闭集，这里逐个写一句人话（`Record<KgErrorCode, string>`：漏配一个
 * 编译就不过）。内部码**不上屏**（`lint:user-facing-error-text`）；不是本束可识别的失败（网络断、
 * 网关、服务端 `KG_INVALID_REQUEST` 这类契约外的码）一律给通用说法，不猜。
 * 用词守 `requirements/06-user-experience.md` R5：说「记忆 / 这一条 / 人和事」，不说内部术语。
 */
import { KG_PROMOTE_MAX_BATCH, type KgPromotionRejectCode } from "@repo/contracts/chat-knowledge-graph";
import type { KnowledgeGraphErrorCode } from "@/lib/knowledge-graph-api";
import { knowledgeGraphErrorCode } from "@/lib/knowledge-graph-api";

const HUMAN_ACTION_FAILURE_KEYS: Record<KnowledgeGraphErrorCode, MessageKey> = {
  KG_THREAD_NOT_FOUND: "aboutMemory.humanError.KG_THREAD_NOT_FOUND",
  KG_NOT_VISIBLE: "aboutMemory.humanError.KG_NOT_VISIBLE",
  KG_NOT_OWNER: "aboutMemory.humanError.KG_NOT_OWNER",
  KG_SCOPE_NOT_PROJECT: "aboutMemory.humanError.KG_SCOPE_NOT_PROJECT",
  KG_REVISION_CHANGED: "aboutMemory.humanError.KG_REVISION_CHANGED",
  KG_CLAIM_NOT_FOUND: "aboutMemory.humanError.KG_CLAIM_NOT_FOUND",
  KG_OBJECT_NOT_FOUND: "aboutMemory.humanError.KG_OBJECT_NOT_FOUND",
  KG_CONTESTED_NEEDS_RESOLUTION: "aboutMemory.humanError.KG_CONTESTED_NEEDS_RESOLUTION",
  KG_ACTOR_NOT_HUMAN: "aboutMemory.humanError.KG_ACTOR_NOT_HUMAN",
  KG_SCOPE_NOT_PERSONAL: "aboutMemory.humanError.KG_SCOPE_NOT_PERSONAL",
  KG_SCOPE_NOT_ENABLED: "aboutMemory.humanError.KG_SCOPE_NOT_ENABLED",
  KG_EVIDENCE_REVOKED: "aboutMemory.humanError.KG_EVIDENCE_REVOKED",
  KG_PROMOTE_BATCH_TOO_LARGE: "aboutMemory.humanError.KG_PROMOTE_BATCH_TOO_LARGE",
  KG_REINDEX_ALREADY_RUNNING: "aboutMemory.humanError.KG_REINDEX_ALREADY_RUNNING",
  KG_CARD_NOT_FOUND: "aboutMemory.humanError.KG_CARD_NOT_FOUND",
  KG_CARD_STALE: "aboutMemory.humanError.KG_CARD_STALE",
  KG_PROMPT_NOT_FOUND: "aboutMemory.humanError.KG_PROMPT_NOT_FOUND",
  KG_NOT_ORG_ADMIN: "aboutMemory.humanError.KG_NOT_ORG_ADMIN",
  KG_CONSOLIDATION_RUN_NOT_FOUND: "aboutMemory.humanError.KG_CONSOLIDATION_RUN_NOT_FOUND",
  KG_CONSOLIDATION_DISABLED: "aboutMemory.humanError.KG_CONSOLIDATION_DISABLED",
  KG_PROJECT_NOT_FOUND: "aboutMemory.humanError.KG_PROJECT_NOT_FOUND",
  KG_PROJECT_READ_ONLY: "aboutMemory.humanError.KG_PROJECT_READ_ONLY",
};
const HUMAN_ACTION_FAILURE_ZH = defaultFailureText(HUMAN_ACTION_FAILURE_KEYS);

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

/**
 * F11 —— 「记到我的长期记忆」逐条被拒的原因（契约 `KgPromotionRejectCode` 闭集，漏配编译不过）。
 * 逐条结果里只说这一条为什么没记下，不说「已为你刷新」这类整批动作的话。
 */
const PROMOTION_REJECT_ZH: Record<KgPromotionRejectCode, string> = {
  KG_CONTESTED_NEEDS_RESOLUTION: "有矛盾，先解决再记下",
  KG_EVIDENCE_REVOKED: "原话已经不在了",
  KG_CLAIM_NOT_FOUND: "这条已经不在了",
};

export function describePromotionReject(code: KgPromotionRejectCode): string {
  return PROMOTION_REJECT_ZH[code];
}

/** 整批被拒（403 / 400 / 404）时的人话：说「长期记忆」，不沿用编辑动作那句「修改」。 */
const PROMOTION_FAILURE_ZH: Partial<Record<KnowledgeGraphErrorCode, string>> = {
  KG_NOT_OWNER: "只有对话的创建者可以把这里的记忆记到长期记忆。",
  KG_SCOPE_NOT_PERSONAL: "只有你自己的个人对话，才能把记忆记到长期记忆。",
  KG_PROMOTE_BATCH_TOO_LARGE: `一次最多记 ${String(KG_PROMOTE_MAX_BATCH)} 条，请分几次操作。`,
};

export function describePromotionFailure(e: unknown): string {
  const code = knowledgeGraphErrorCode(e);
  if (code === null) return "没能记到长期记忆，请稍后重试。";
  return PROMOTION_FAILURE_ZH[code] ?? HUMAN_ACTION_FAILURE_ZH[code];
}

/**
 * F17 —— 回答下「记住 / 忘掉」确认卡被拒时的人话（uc-18-6 E1 / E2）。卡上的话说「记忆」，不说「修改」。
 */
const MEMORY_CARD_FAILURE_ZH: Partial<Record<KnowledgeGraphErrorCode, string>> = {
  KG_NOT_OWNER: "只有对话创建者能管理记忆。",
  KG_CARD_STALE: "内容已经变了，已为你刷新，请看最新的再决定。",
  KG_CARD_NOT_FOUND: "这张卡片已经不在了。",
  KG_CONTESTED_NEEDS_RESOLUTION: "这条和你之前说的有矛盾，先选好保留哪条，再记到长期记忆。",
  KG_ACTOR_NOT_HUMAN: "这个操作只能由你本人在界面上完成。",
};

/** 失败后应当重读这一轮记忆的码：卡片在服务端已经不是界面上的样子了。 */
export const MEMORY_CARD_RELOAD_ON_FAILURE: ReadonlySet<KnowledgeGraphErrorCode> = new Set(["KG_CARD_STALE", "KG_CARD_NOT_FOUND"]);

export function describeMemoryCardFailure(e: unknown): string {
  const code = knowledgeGraphErrorCode(e);
  if (code === null) return "没能完成这次操作，请稍后重试。";
  return MEMORY_CARD_FAILURE_ZH[code] ?? HUMAN_ACTION_FAILURE_ZH[code];
}

/**
 * issue #4302 —— 大脑页（/brain）「忘掉这条」「撤销取代」失败时的人话。这两个动作复用对话里的既有动作，
 * 多数码沿用编辑动作那一句；这几句按大脑页的处境改说法（这里没有「提醒」，修改发生在出自的那个对话上）。
 */
const BRAIN_ACTION_FAILURE_KEYS: Partial<Record<KnowledgeGraphErrorCode, MessageKey>> = {
  KG_CLAIM_NOT_FOUND: "aboutMemory.brainError.KG_CLAIM_NOT_FOUND",
  KG_PROMPT_NOT_FOUND: "aboutMemory.brainError.KG_PROMPT_NOT_FOUND",
  KG_THREAD_NOT_FOUND: "aboutMemory.brainError.KG_THREAD_NOT_FOUND",
  KG_NOT_OWNER: "aboutMemory.brainError.KG_NOT_OWNER",
};

/**
 * issue #4302 review：「忘掉这条」的每一步都成功了，重读后那条长期记忆却仍然活着——还有界面看不到的来源在撑着它
 * （例如刚在别的对话里又记下了一次）。不报成功，如实说。
 */
export const BRAIN_FORGET_STILL_LIVE_ZH = translate("zh-CN", "aboutMemory.stillLive");

export function describeBrainActionFailure(e: unknown, locale: Locale = "zh-CN"): string {
  const code = knowledgeGraphErrorCode(e);
  return translate(locale, code === null ? "aboutMemory.error.generic" : BRAIN_ACTION_FAILURE_KEYS[code] ?? HUMAN_ACTION_FAILURE_KEYS[code]);
}

function defaultFailureText<K extends string>(keys: Record<K, MessageKey>): Record<K, string> {
  const text = {} as Record<K, string>;
  for (const code of Object.keys(keys) as K[]) text[code] = translate("zh-CN", keys[code]);
  return text;
}
