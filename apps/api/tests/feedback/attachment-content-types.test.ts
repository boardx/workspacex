/**
 * UC-17.8 D3 —— 附件类型放宽到图片 + PDF + 纯文本/Markdown，白名单从契约派生。
 *   · PDF（`%PDF-`）通过；zip（`PK\x03\x04`）无论声明成什么都拒；
 *   · text/plain 含 NUL 拒、非法 UTF-8 拒、正常 UTF-8 文本通过；声明成文本的 PDF 拒；
 *   · 白名单与契约 `FeedbackAttachmentMime.options` 逐项一致（不是第二份）；上限 = 契约常量。
 */
import { describe, expect, it, vi } from "vitest";
import { feedbackLoop } from "@repo/contracts";
import { toOrgId } from "../../src/domain/org-id";
import {
  FEEDBACK_ATTACHMENT_CONTENT_TYPES,
  FEEDBACK_ATTACHMENT_MAX_PER_FEEDBACK,
  UploadFeedbackAttachmentError,
  sniffDeclaredType,
  uploadFeedbackAttachment,
} from "../../src/application/feedback/upload-feedback-attachment";
import { FakeAttachmentRepo } from "./draft-fakes";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const TEXT = new TextEncoder().encode("复现日志：\n1. 点导出\n2. 卡住");

function deps() {
  const attachments = new FakeAttachmentRepo();
  const store = { putOnce: vi.fn(async () => {}), get: vi.fn(async () => null), head: vi.fn(async () => null) };
  return { store, attachments };
}

describe("UC-17.8 D3 附件类型", () => {
  it("白名单只在契约里写一遍；上限是契约常量", () => {
    expect([...FEEDBACK_ATTACHMENT_CONTENT_TYPES]).toEqual([...feedbackLoop.FeedbackAttachmentMime.options]);
    expect(FEEDBACK_ATTACHMENT_MAX_PER_FEEDBACK).toBe(feedbackLoop.FEEDBACK_ATTACHMENT_MAX);
    expect(FEEDBACK_ATTACHMENT_MAX_PER_FEEDBACK).toBe(5);
  });

  it("sniffDeclaredType：magic-byte 与声明必须一致；文本按 UTF-8 + 无 NUL 放行", () => {
    expect(sniffDeclaredType("application/pdf", PDF)).toBe("application/pdf");
    expect(sniffDeclaredType("image/png", PDF)).toBeNull();
    expect(sniffDeclaredType("application/pdf", PNG)).toBeNull();
    expect(sniffDeclaredType("application/zip", ZIP)).toBeNull();
    expect(sniffDeclaredType("text/plain", ZIP)).toBeNull(); // 含 NUL
    expect(sniffDeclaredType("text/plain", TEXT)).toBe("text/plain");
    expect(sniffDeclaredType("text/markdown", TEXT)).toBe("text/markdown");
    expect(sniffDeclaredType("text/plain", PDF)).toBeNull(); // 有 magic-byte 的东西不是文本
    expect(sniffDeclaredType("text/plain", new Uint8Array([0x61, 0xff, 0x62]))).toBeNull(); // 非法 UTF-8
    expect(sniffDeclaredType("text/plain", new Uint8Array([0x61, 0x00, 0x62]))).toBeNull(); // NUL
  });

  it("上传：PDF 通过并以嗅探结果落库", async () => {
    const d = deps();
    const out = await uploadFeedbackAttachment(d, { orgId: toOrgId("org-1"), uploadedBy: "u-1", declaredContentType: "application/pdf", bytes: PDF });
    expect(out.url).toBe(`/feedback/attachments/${out.attachmentId}`);
    expect(d.attachments.rows.get(out.attachmentId)).toMatchObject({ contentType: "application/pdf", uploadedBy: "u-1" });
    expect(d.store.putOnce).toHaveBeenCalledWith(expect.stringContaining("feedback-attachments/org-1/"), PDF, "application/pdf");
  });

  it("上传：zip 拒、文本含 NUL 拒——UNSUPPORTED_CONTENT_TYPE，且不写字节", async () => {
    const d = deps();
    const input = { orgId: toOrgId("org-1"), uploadedBy: "u-1" };
    await expect(uploadFeedbackAttachment(d, { ...input, declaredContentType: "application/zip", bytes: ZIP }))
      .rejects.toMatchObject({ reasonCode: "UNSUPPORTED_CONTENT_TYPE" });
    await expect(uploadFeedbackAttachment(d, { ...input, declaredContentType: "text/plain", bytes: ZIP }))
      .rejects.toBeInstanceOf(UploadFeedbackAttachmentError);
    await expect(uploadFeedbackAttachment(d, { ...input, declaredContentType: "text/markdown", bytes: new Uint8Array([0x61, 0x00]) }))
      .rejects.toMatchObject({ reasonCode: "UNSUPPORTED_CONTENT_TYPE" });
    expect(d.store.putOnce).not.toHaveBeenCalled();
    expect(d.attachments.rows.size).toBe(0);
  });

  it("上传：正常 UTF-8 文本通过", async () => {
    const d = deps();
    const out = await uploadFeedbackAttachment(d, { orgId: toOrgId("org-1"), uploadedBy: "u-1", declaredContentType: "text/markdown", bytes: TEXT });
    expect(d.attachments.rows.get(out.attachmentId)!.contentType).toBe("text/markdown");
  });
});
