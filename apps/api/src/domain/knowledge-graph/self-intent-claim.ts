/**
 * issue #4343（人类决定 2026-09-27）—— 「本人意向类」结论（`goal` 目标 / `preference` 偏好）的两处用法：
 *
 *   1. 抽取任务里：作者本人说的 ⇒ 自动记进作者本人的个人空间（同 #4283 的决定，`auto-copy-decisions.ts`）；
 *   2. 召回时：本会话 + 本人个人空间里的，每一轮强制带上（同 #4181 的决定，`recall.ts`），名额另计。
 *
 * 与 `decisionLike()` 的区别：决定类是按词表从说法里认的（decision-claim.ts）；目标 / 偏好有自己的结论类型
 * （契约 `KG_SELF_INTENT_CLAIM_KINDS`，唯一事实源），这里**先看类型**，再用一道保守的句式门兜住模型的误标——
 * 宁可漏不可误（误判的代价同 decision-claim.ts 文件头：一句话从此每轮挤占强制召回位）：
 *
 *   - 必须是**第一人称单数开头**（「我的目标是…」「我想…」「我更喜欢…」）：抽取 prompt 要求本人意向保留「我」；
 *     「张三的目标是…」（别人的）、「我们的目标是…」（集体的）一律不算；
 *   - 问句（句末问号 / 「…吗」「…呢」）不算；
 *   - 带假设 / 条件（「如果…」「万一…」）不算：说的是还没成立的情形，不是本人现在的目标；
 *   - 对助手的请求（「我想让你…」「我想问…」「我希望你…」）不算：是这一轮要办的事，不是本人的长期意向（#4392 评审）；
 *   - 「目标函数」这类术语不算：「我的目标函数是…」说的是模型，不是人。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import { QUESTION_TAIL } from "./decision-claim";
import { QUESTION_END } from "./question-detection";

/**
 * 召回时目标 / 偏好的强制上限。**不与 `DECISION_RECALL_LIMIT` 共用**：共用的话，记下几条目标就会把刚拍板的
 * 决定挤出上下文（反之亦然）；两类各自有界，最坏一轮额外 3 + 3 条短句。取 3（目标与偏好合用）：与决定类同一量级，
 * 够放「一个目标 + 一两条偏好」；超过时按最新证据时间取（同决定类）。
 */
export const SELF_INTENT_RECALL_LIMIT = 3;

const MIN_STATEMENT_LENGTH = 4;
/** 第一人称单数开头；「我们」是集体口吻，不算本人意向。 */
const SELF_LEAD = /^我(?!们)/;
const HYPOTHETICAL = /如果|假如|假设|要是|倘若|假使|万一/;
/** 「我想 / 希望 / 要 / 需要」后面紧跟的是对助手的请求或提问。 */
const REQUEST_TO_ASSISTANT = /^我(?:想|希望|要|需要)(?:问|请教|咨询|了解一下|让你|请你|你)/;
const TECHNICAL_GOAL_TERM = /目标函数/;

/** 这条结论能不能当作「本人意向」对待（自动记入本人空间 / 强制召回）。不确定一律 false。 */
export function selfIntentLike(kind: KG.KgClaimKind | null | undefined, statement: string): boolean {
  if (!KG.isSelfIntentClaimKind(kind)) return false;
  const text = statement.normalize("NFKC").trim();
  if (text.length < MIN_STATEMENT_LENGTH) return false;
  if (!SELF_LEAD.test(text)) return false;
  if (QUESTION_END.test(text) || QUESTION_TAIL.test(text)) return false;
  if (HYPOTHETICAL.test(text)) return false;
  if (REQUEST_TO_ASSISTANT.test(text) || TECHNICAL_GOAL_TERM.test(text)) return false;
  return true;
}
