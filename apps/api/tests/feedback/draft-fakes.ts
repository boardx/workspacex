/**
 * UC-17.8 B1 —— 草稿用例单测共用的内存 fake（同 `submit-feedback-confirmation.test.ts` 的假仓库风格，
 * 但有真实的状态：草稿 Map + 附件 Map，让「提交后草稿消失、附件迁到反馈」这类断言能读到真状态）。
 */
import { vi } from "vitest";
import type { FeedbackAttachmentRepository, FeedbackAttachmentRow } from "../../src/application/feedback/attachment-ports";
import type { FeedbackDraftRepository, FeedbackDraftRow, NewFeedbackDraft } from "../../src/application/feedback/draft-ports";
import type { NewFeedback, ProductFeedbackRepository, StatusEvent } from "../../src/application/feedback/ports";
import {
  REFINE_ACK,
  REFINE_SEED_QUESTION,
  type AiReply,
  type DraftRefineContext,
  type DraftRefineModel,
  type DraftSummary,
} from "../../src/application/feedback/drafts/draft-refine-model";

export class FakeDraftRepo implements FeedbackDraftRepository {
  readonly rows = new Map<string, FeedbackDraftRow>();
  private tick = 0;

  private stamp(): string {
    this.tick += 1;
    return new Date(Date.UTC(2026, 8, 4, 0, 0, this.tick)).toISOString();
  }

  async create(draft: NewFeedbackDraft): Promise<void> {
    const at = this.stamp();
    this.rows.set(draft.id, { ...draft, chat: [], refineSeeded: false, createdAt: at, updatedAt: at });
  }
  async listMine(ownerId: string): Promise<readonly FeedbackDraftRow[]> {
    return [...this.rows.values()].filter((r) => r.ownerId === ownerId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async countMine(ownerId: string): Promise<number> {
    return (await this.listMine(ownerId)).length;
  }
  async get(draftId: string, ownerId: string): Promise<FeedbackDraftRow | null> {
    const r = this.rows.get(draftId);
    return r !== undefined && r.ownerId === ownerId ? r : null;
  }
  async update(draftId: string, ownerId: string, patch: Parameters<FeedbackDraftRepository["update"]>[2]): Promise<FeedbackDraftRow | null> {
    const r = await this.get(draftId, ownerId);
    if (r === null) return null;
    const next: FeedbackDraftRow = {
      ...r,
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
      ...(patch.structured !== undefined ? { structured: patch.structured } : {}),
      ...(patch.chat !== undefined ? { chat: [...patch.chat] } : {}),
      ...(patch.refineSeeded !== undefined ? { refineSeeded: patch.refineSeeded } : {}),
      updatedAt: this.stamp(),
    };
    this.rows.set(draftId, next);
    return next;
  }
  async delete(draftId: string, ownerId: string): Promise<boolean> {
    const r = await this.get(draftId, ownerId);
    if (r === null) return false;
    this.rows.delete(draftId);
    return true;
  }
}

export class FakeAttachmentRepo implements FeedbackAttachmentRepository {
  readonly rows = new Map<string, FeedbackAttachmentRow>();

  seed(id: string, uploadedBy: string, contentType: FeedbackAttachmentRow["contentType"] = "image/png"): void {
    this.rows.set(id, {
      id, orgId: "org-1", uploadedBy, feedbackId: null, draftId: null, objectKey: null,
      contentType, sizeBytes: 3, sha256: "x", createdAt: "2026-09-04T00:00:00.000Z",
    });
  }
  async create(row: Parameters<FeedbackAttachmentRepository["create"]>[0]): Promise<void> {
    this.rows.set(row.id, { ...row, feedbackId: null, draftId: null, objectKey: null, createdAt: "2026-09-04T00:00:00.000Z" });
  }
  async claimForFeedback(_org: unknown, feedbackId: string, ids: readonly string[], uploadedBy: string): Promise<number> {
    let n = 0;
    for (const id of ids) {
      const r = this.rows.get(id);
      if (r && r.uploadedBy === uploadedBy && r.feedbackId === null && r.draftId === null) { this.rows.set(id, { ...r, feedbackId }); n++; }
    }
    return n;
  }
  async findByFeedbackIds(_org: unknown, feedbackIds: readonly string[]): Promise<readonly FeedbackAttachmentRow[]> {
    return [...this.rows.values()].filter((r) => r.feedbackId !== null && feedbackIds.includes(r.feedbackId));
  }
  async findById(_org: unknown, id: string): Promise<FeedbackAttachmentRow | null> {
    return this.rows.get(id) ?? null;
  }
  async claimForDraft(_org: unknown, draftId: string, ids: readonly string[], uploadedBy: string): Promise<number> {
    let n = 0;
    for (const id of ids) {
      const r = this.rows.get(id);
      if (r && r.uploadedBy === uploadedBy && r.feedbackId === null && r.draftId === null) { this.rows.set(id, { ...r, draftId }); n++; }
    }
    return n;
  }
  async moveDraftAttachmentsToFeedback(_org: unknown, draftId: string, feedbackId: string): Promise<number> {
    let n = 0;
    for (const [id, r] of this.rows) {
      if (r.draftId === draftId && r.feedbackId === null) { this.rows.set(id, { ...r, draftId: null, feedbackId }); n++; }
    }
    return n;
  }
  async releaseDraftAttachments(_org: unknown, draftId: string): Promise<number> {
    let n = 0;
    for (const [id, r] of this.rows) {
      if (r.draftId === draftId) { this.rows.set(id, { ...r, draftId: null }); n++; }
    }
    return n;
  }
  async findByDraftIds(_org: unknown, draftIds: readonly string[], ownerId: string): Promise<readonly FeedbackAttachmentRow[]> {
    return [...this.rows.values()].filter((r) => r.draftId !== null && draftIds.includes(r.draftId) && r.uploadedBy === ownerId);
  }
}

/** `submitFeedback` 只需要这三个方法（同 `submit-feedback-confirmation.test.ts` 的 fake）。 */
export function fakeFeedbackRepo() {
  const inserted: NewFeedback[] = [];
  const events: StatusEvent[] = [];
  const repo = {
    insert: vi.fn(async (r: NewFeedback) => { inserted.push(r); }),
    appendStatusEvent: vi.fn(async (e: StatusEvent) => { events.push(e); }),
    markStatusEventNotified: vi.fn(async () => {}),
  } as unknown as ProductFeedbackRepository;
  return { repo, inserted, events };
}

/**
 * B5.1：`DraftRefineModel` 的内存 fake——默认退回 D7 固定文案（`source: "fallback"`），
 * 记录每次调用看到的上下文；测试可以换掉 `answers` 让它"像模型一样"说话。
 */
export class FakeDraftRefiner implements DraftRefineModel {
  readonly calls: { readonly what: "seed" | "reply" | "summarize"; readonly ctx: DraftRefineContext }[] = [];
  answers: { seed?: AiReply; reply?: AiReply; summarize?: DraftSummary } = {};
  async seedQuestion(ctx: DraftRefineContext): Promise<AiReply> {
    this.calls.push({ what: "seed", ctx: { ...ctx, chat: [...ctx.chat] } });
    return this.answers.seed ?? { text: REFINE_SEED_QUESTION, source: "fallback" };
  }
  async reply(ctx: DraftRefineContext): Promise<AiReply> {
    this.calls.push({ what: "reply", ctx: { ...ctx, chat: [...ctx.chat] } });
    return this.answers.reply ?? { text: REFINE_ACK, source: "fallback" };
  }
  async summarize(ctx: DraftRefineContext): Promise<DraftSummary> {
    this.calls.push({ what: "summarize", ctx: { ...ctx, chat: [...ctx.chat] } });
    return this.answers.summarize ?? { structured: ctx.structured, source: "fallback" };
  }
}
