/**
 * UC-17.8 B1.7 —— 草稿附件下载：只有 owner 本人可读，管理员也不行；提交后按原反馈 D3 逻辑；
 * 未认领恒 404。用 `draft-fakes.ts` 的假仓库 + 真实 `guard()`（同 `pg-feedback-attachment-repository.ts`
 * 的挂靠规则），走真实的 `downloadFeedbackAttachment` 用例与 `permission-filter`。
 */
import { describe, expect, it } from "vitest";
import { guard } from "../../src/application/security/permission-filter";
import {
  downloadFeedbackAttachment,
  FeedbackAttachmentNotFoundError,
} from "../../src/application/feedback/download-feedback-attachment";
import { FeedbackNotFoundError } from "../../src/application/feedback/triage-feedback";
import type { FeedbackDraftRepositoryFactory } from "../../src/application/feedback/draft-ports";
import { toOrgId } from "../../src/domain/org-id";
import { FakeAttachmentRepo, FakeDraftRepo } from "./draft-fakes";

const ORG = toOrgId("org-1");

function draftsFactory(repo: FakeDraftRepo): FeedbackDraftRepositoryFactory {
  return { forOrg: () => repo };
}

describe("downloadFeedbackAttachment · draft-attached (B1.7)", () => {
  function setup() {
    const drafts = new FakeDraftRepo();
    const attachments = new FakeAttachmentRepo();
    let n = 0;
    const deps = {
      attachments,
      feedback: { findById: async () => null },
      drafts: draftsFactory(drafts),
      newDecisionId: () => `dec-${(n += 1)}`,
    };
    return { drafts, attachments, deps };
  }

  it("owner can download their own draft's attachment", async () => {
    const { drafts, attachments, deps } = setup();
    await drafts.create({
      id: "draft-1", ownerId: "user-owner", kind: "缺陷",
      target: { kind: "product" }, detail: "反馈正文", structured: null,
      occurredRoute: null, appVersion: null,
    });
    attachments.rows.set("att-1", {
      id: "att-1", orgId: ORG, uploadedBy: "user-owner", feedbackId: null, draftId: "draft-1",
      objectKey: guard({ kind: "feedback_draft", id: "draft-1" }, "s3://bucket/att-1"),
      contentType: "image/png", sizeBytes: 3, sha256: "x", createdAt: "2026-09-04T00:00:00.000Z",
    });

    const result = await downloadFeedbackAttachment(deps as never, {
      orgId: ORG, attachmentId: "att-1", viewerId: "user-owner",
      viewerOrgRole: "consultant", viewerTeamId: null,
    });
    expect(result).toEqual({ objectKey: "s3://bucket/att-1", contentType: "image/png" });
  });

  // ⚠ `FeedbackDraftRepository.get(draftId, ownerId)` is owner-scoped by construction
  // (every draft method takes `ownerId` and filters in the query, see `draft-ports.ts`
  // header) — so a non-owner (even an admin) gets `null` back and this collapses to
  // `FeedbackAttachmentNotFoundError`, never `FeedbackAttachmentAccessDeniedError`. This
  // is the "404 not 403, don't leak existence" rule from the B1.7 backlog item working as
  // intended, not a shortcut: `decideFeedbackDraftAttachmentVisibility` is still called as
  // defense-in-depth for the (draft-not-null) branch, so a future repository bug that
  // returns a foreign owner's row would still be caught and denied.
  it("a non-owner org member (even an admin) gets 404, not 403 — existence is not leaked", async () => {
    const { drafts, attachments, deps } = setup();
    await drafts.create({
      id: "draft-1", ownerId: "user-owner", kind: "缺陷",
      target: { kind: "product" }, detail: "反馈正文", structured: null,
      occurredRoute: null, appVersion: null,
    });
    attachments.rows.set("att-1", {
      id: "att-1", orgId: ORG, uploadedBy: "user-owner", feedbackId: null, draftId: "draft-1",
      objectKey: guard({ kind: "feedback_draft", id: "draft-1" }, "s3://bucket/att-1"),
      contentType: "image/png", sizeBytes: 3, sha256: "x", createdAt: "2026-09-04T00:00:00.000Z",
    });

    await expect(
      downloadFeedbackAttachment(deps as never, {
        orgId: ORG, attachmentId: "att-1", viewerId: "user-admin",
        viewerOrgRole: "admin", viewerTeamId: null,
      }),
    ).rejects.toBeInstanceOf(FeedbackAttachmentNotFoundError);
  });

  it("the visibility decision itself denies a non-owner (defense-in-depth, bypassing repo scoping)", async () => {
    // Exercises `decideFeedbackDraftAttachmentVisibility` directly, in case a future
    // repository implementation stops owner-scoping `get()` and starts returning
    // someone else's row — the decision function must still say no on its own.
    const { decideFeedbackDraftAttachmentVisibility } = await import(
      "../../src/application/feedback/drafts/draft-attachment-decision"
    );
    const decision = decideFeedbackDraftAttachmentVisibility({
      decisionId: "dec-x", viewerId: "user-admin", viewerOrgRole: "admin",
      viewerTeamId: null, draftOwnerId: "user-owner",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("ORG_SCOPE_DENIED");
  });

  it("returns 404 (not-found), not 403, when the draft is not the viewer's (existence not leaked)", async () => {
    const { attachments, deps } = setup();
    attachments.rows.set("att-1", {
      id: "att-1", orgId: ORG, uploadedBy: "user-owner", feedbackId: null, draftId: "draft-missing",
      objectKey: guard({ kind: "feedback_draft", id: "draft-missing" }, "s3://bucket/att-1"),
      contentType: "image/png", sizeBytes: 3, sha256: "x", createdAt: "2026-09-04T00:00:00.000Z",
    });

    await expect(
      downloadFeedbackAttachment(deps as never, {
        orgId: ORG, attachmentId: "att-1", viewerId: "user-owner",
        viewerOrgRole: "consultant", viewerTeamId: null,
      }),
    ).rejects.toBeInstanceOf(FeedbackAttachmentNotFoundError);
  });

  it("unclaimed (neither feedbackId nor draftId) is always 404", async () => {
    const { attachments, deps } = setup();
    attachments.seed("att-1", "user-owner");

    await expect(
      downloadFeedbackAttachment(deps as never, {
        orgId: ORG, attachmentId: "att-1", viewerId: "user-owner",
        viewerOrgRole: "consultant", viewerTeamId: null,
      }),
    ).rejects.toBeInstanceOf(FeedbackAttachmentNotFoundError);
  });

  it("a nonexistent attachment id is 404", async () => {
    const { deps } = setup();
    await expect(
      downloadFeedbackAttachment(deps as never, {
        orgId: ORG, attachmentId: "att-missing", viewerId: "user-owner",
        viewerOrgRole: "consultant", viewerTeamId: null,
      }),
    ).rejects.toBeInstanceOf(FeedbackAttachmentNotFoundError);
  });

  it("after submission (claimed by a feedback), falls through to the existing D3 feedback path", async () => {
    const { attachments } = setup();
    attachments.rows.set("att-1", {
      id: "att-1", orgId: ORG, uploadedBy: "user-owner", feedbackId: "fb-1", draftId: null,
      objectKey: guard({ kind: "feedback", id: "fb-1" }, "s3://bucket/att-1"),
      contentType: "image/png", sizeBytes: 3, sha256: "x", createdAt: "2026-09-04T00:00:00.000Z",
    });
    const deps = {
      attachments,
      feedback: { findById: async () => null },
      drafts: draftsFactory(new FakeDraftRepo()),
      newDecisionId: () => "dec-1",
    };

    // No feedback row found ⇒ the existing D3 path's FeedbackNotFoundError, proving the
    // draft branch was NOT taken (draftId is null so it never even queries `drafts`).
    await expect(
      downloadFeedbackAttachment(deps as never, {
        orgId: ORG, attachmentId: "att-1", viewerId: "user-owner",
        viewerOrgRole: "consultant", viewerTeamId: null,
      }),
    ).rejects.toBeInstanceOf(FeedbackNotFoundError);
  });
});
