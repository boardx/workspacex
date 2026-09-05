/**
 * `updateFeedbackDraft`（UC-17.8 B1）—— 改类型 / 正文 / 结构化字段，或**追加**一条对话。
 *
 * ## 对话是追加不覆盖（PDF §7 已知模拟点：编辑覆盖会丢原始轨迹）
 *
 *   · `detail` 变化 ⇒ 追加 `{ role: "user", kind: "edit", text: <新正文> }`；`detail` 才是当前值。
 *     正文与旧值相同时不追加（一次无变化的保存不是一次编辑）。空正文不追加（契约
 *     `text.min(1)`——一条空的 edit 记录没有信息量，而正文本身允许清空）。
 *   · `appendChat` ⇒ 直接追加，`at` 服务端给。
 *   · **seed 只一次**：首次 `appendChat` 且 `refineSeeded === false` 时，服务端先追加一条 AI 澄清
 *     问题，再追加用户消息，并把 `refineSeeded` 置 true。
 *   · 每条用户消息之后追加一条 AI 回复。
 *
 * ## UC-17.8 B5.1：澄清问题与回复由模型生成，退路是 D7 固定回执
 *
 * D7 上线时（2026-09-02）这两条 AI 记录是固定文案 `REFINE_SEED_QUESTION`/`REFINE_ACK`。
 * B5.1 起由 `deps.refine`（`DraftRefineModel`，唯一实现 `ModelDraftRefiner`）按 `kind` +
 * 已有结构化字段 + 正文 + 完整对话历史生成；模型不可用时端口自己退回固定文案并标
 * `source: "fallback"`，本用例**不区分**这两种情况——它只负责把端口给的话追加进去。
 * 固定文案的单一事实源搬到了 `draft-refine-model.ts`，这里只是转发导出（既有 import 路径不变）。
 *
 * ⚠ 四个字段都不传 ⇒ 空操作，原样返回（契约头注逐字）。
 * ⚠ 所有追加算好之后**一条** UPDATE 整体写回 `chat`——不是逐条 append 三次。
 */
import type { FeedbackDraftChatTurn } from "../draft-ports";
import type { FeedbackKind, FeedbackStructured } from "../ports";
import { FeedbackDraftNotFoundError, loadDraftView, type FeedbackDraftDeps, type FeedbackDraftView } from "./draft-shared";

import type { DraftRefineModel } from "./draft-refine-model";

export { REFINE_ACK, REFINE_SEED_QUESTION } from "./draft-refine-model";

export interface UpdateFeedbackDraftDeps extends FeedbackDraftDeps {
  readonly now: () => Date;
  /** B5.1：澄清问题/回复的来源（模型或退路），见 `draft-refine-model.ts`。 */
  readonly refine: DraftRefineModel;
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
    // 模型看到的是**本次调用生效后**的草稿：类型/正文/字段若同一次调用里改了，按改后的算。
    const ctx = {
      kind: input.kind ?? current.kind,
      detail: input.detail ?? current.detail,
      structured: input.structured !== undefined ? input.structured : current.structured,
      chat,
    };
    if (!current.refineSeeded) {
      const seed = await deps.refine.seedQuestion(ctx);
      chat.push({ role: "ai", kind: "message", text: seed.text, at, source: seed.source });
      refineSeeded = true;
    }
    chat.push({ ...input.appendChat, at });
    if (input.appendChat.role === "user") {
      const reply = await deps.refine.reply(ctx);
      chat.push({ role: "ai", kind: "message", text: reply.text, at, source: reply.source });
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
