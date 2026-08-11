/**
 * #946 · V9-a F150 —— 附件上传纯领域校验单测（无 DB / 无 HTTP，纯函数）。
 * 数值上限逐字来自契约，不在测试里另写一份——用契约常量断言，避免第二份会漂移的副本。
 */
import { describe, expect, it } from "vitest";
import { chatFileUpload as CFU } from "@repo/contracts";
import {
  checkAttachmentBytesAndType,
  checkAttachmentCount,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_PENDING_LIMIT,
} from "../../src/domain/chat/attachment-upload";

const ok = "application/pdf"; // 白名单内

describe("checkAttachmentBytesAndType", () => {
  it("白名单内、未超上限 → 通过（null）", () => {
    expect(checkAttachmentBytesAndType({ bytes: 1024, mime: ok })).toBeNull();
    // 恰好等于上限也通过（上限是「不超过」）
    expect(checkAttachmentBytesAndType({ bytes: ATTACHMENT_MAX_BYTES, mime: ok })).toBeNull();
  });

  it("超单文件字节上限 → FILE_TOO_LARGE", () => {
    expect(checkAttachmentBytesAndType({ bytes: ATTACHMENT_MAX_BYTES + 1, mime: ok })).toBe("FILE_TOO_LARGE");
  });

  it("MIME 不在白名单 → FILE_TYPE_REJECTED", () => {
    expect(checkAttachmentBytesAndType({ bytes: 1024, mime: "application/x-msdownload" })).toBe("FILE_TYPE_REJECTED");
  });

  it("非法字节数（负/NaN）→ FILE_TYPE_REJECTED（防脏输入）", () => {
    expect(checkAttachmentBytesAndType({ bytes: -1, mime: ok })).toBe("FILE_TYPE_REJECTED");
    expect(checkAttachmentBytesAndType({ bytes: Number.NaN, mime: ok })).toBe("FILE_TYPE_REJECTED");
  });

  it("白名单逐条来自契约（不是测试里另写的第二份）", () => {
    for (const mime of CFU.ATTACHMENT_MIME_ALLOWLIST) {
      expect(checkAttachmentBytesAndType({ bytes: 1, mime })).toBeNull();
    }
  });
});

describe("checkAttachmentCount", () => {
  it("pending 未达上限 → 通过", () => {
    expect(checkAttachmentCount(0)).toBeNull();
    expect(checkAttachmentCount(ATTACHMENT_PENDING_LIMIT - 1)).toBeNull();
  });
  it("pending 已达上限（再加一个会越限）→ ATTACHMENT_LIMIT_EXCEEDED", () => {
    expect(checkAttachmentCount(ATTACHMENT_PENDING_LIMIT)).toBe("ATTACHMENT_LIMIT_EXCEEDED");
    expect(checkAttachmentCount(ATTACHMENT_PENDING_LIMIT + 5)).toBe("ATTACHMENT_LIMIT_EXCEEDED");
  });
});
