/**
 * `updateFeedbackDraft`（UC-17.8 B1）—— 改类型 / 正文 / 结构化字段，或**追加**一条对话。
 *
 * ## 对话是追加不覆盖（PDF §7 已知模拟点：编辑覆盖会丢原始轨迹）
 *
 *   · `detail` 变化 ⇒ 追加 `{ role: "user", kind: "edit", text: <新正文> }`；`detail` 才是当前值。
 *     正文与旧值相同时不追加（一次无变化的保存不是一次编辑）。空正文不追加（契约
 *     `text.min(1)`——一条空的 edit 记录没有信息量，而正文本身允许清空）。
 *   · `appendChat` ⇒ 直接追加，`at` 服务端给。
 *   · **seed 只一次**：首次 `appendChat` 且 `refineSeeded === false` 时，服务端先追加一条固定的
 *     AI 澄清问题（`REFINE_SEED_QUESTION`），再追加用户消息，并把 `refineSeeded` 置 true。
 *   · **固定回执**（D7：不接模型）：每条用户消息之后追加 `REFINE_ACK`。
 *
 * ⚠ 四个字段都不传 ⇒ 空操作，原样返回（契约头注逐字）。
 * ⚠ 所有追加算好之后**一条** UPDATE 整体写回 `chat`——不是逐条 append 三次。
 */
import type { FeedbackDraftChatTurn } from "../draft-ports";
import type { FeedbackKind, FeedbackStructured } from "../ports";
import { FeedbackDraftNotFoundError, loadDraftView, type FeedbackDraftDeps, type FeedbackDraftView } from "./draft-shared";

/** D7 固定文案——单一事实源，前端不复述。 */
export const REFINE_SEED_QUESTION =
  "这个需求/问题的边界在哪：只影响当前场景，还是所有相关入口都要一起改？优先级怎么排？";
export const REFINE_ACK = "已记录，还有想补充的吗？";

export interface UpdateFeedbackDraftDeps extends FeedbackDraftDeps {
  readonly now: () => Date;
}

export interface UpdateFeedbackDraftInput {
  readonly draftId: string;
  readonly ownerId: string;
  readonly kind?: FeedbackKind;
  readonly detail?: string;
  readonly structured?: FeedbackStructured | null;
  readonly appendChat?: Omit<FeedbackDraftChatTurn, "at">;
}

export async function updateFeedbackDraft(
  deps: UpdateFeedbackDraftDeps,
  input: UpdateFeedbackDraftInput,
): Promise<{ readonly draft: FeedbackDraftView }> {
  const current = await deps.drafts.get(input.draftId, input.ownerId);
  if (current === null) throw new FeedbackDraftNotFoundError();

  const noop =
    input.kind === undefined && input.detail === undefined && input.structured === undefined && input.appendChat === undefined;
  if (noop) return { draft: await loadDraftView(deps, input.draftId, input.ownerId) };

  const at = deps.now().toISOString();
  const chat: FeedbackDraftChatTurn[] = [...current.chat];
  let refineSeeded: boolean | undefined;

  if (input.detail !== undefined && input.detail !== current.detail && input.detail.trim() !== "") {
    chat.push({ role: "user", kind: "edit", text: input.detail, at });
  }
  if (input.appendChat !== undefined) {
    if (!current.refineSeeded) {
      chat.push({ role: "ai", kind: "message", text: REFINE_SEED_QUESTION, at });
      refineSeeded = true;
    }
    chat.push({ ...input.appendChat, at });
    if (input.appendChat.role === "user") {
      chat.push({ role: "ai", kind: "message", text: REFINE_ACK, at });
    }
  }

  const updated = await deps.drafts.update(input.draftId, input.ownerId, {
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
    ...(input.structured !== undefined ? { structured: input.structured } : {}),
    ...(chat.length !== current.chat.length ? { chat } : {}),
    ...(refineSeeded !== undefined ? { refineSeeded } : {}),
  });
  if (updated === null) throw new FeedbackDraftNotFoundError();
  return { draft: await loadDraftView(deps, input.draftId, input.ownerId) };
}
