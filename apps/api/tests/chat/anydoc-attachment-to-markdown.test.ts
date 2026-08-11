/**
 * #946 · F153/W1 —— `AnydocAttachmentToMarkdown` 对**真实 @firecrawl/anydoc** 的反证。
 *
 * 为什么真跑 anydoc：这层的全部价值就是「原生二进制能在本环境把字节转成 markdown、失败码能
 * 收敛」——mock 掉 anydoc 等于把唯一要证的东西证没了。这条同时是「anydoc 在 CI/本机（napi
 * 预编译二进制、libc）真的可用」的活体检查：装错版本/平台缺二进制，这里当场红。
 */
import { describe, expect, it } from "vitest";
import { AnydocAttachmentToMarkdown } from "../../src/infrastructure/chat/anydoc-attachment-to-markdown";

const conv = new AnydocAttachmentToMarkdown();

describe("AnydocAttachmentToMarkdown（真库 anydoc）", () => {
  it("CSV → markdown 表格（ok:true，含表头与数据）", async () => {
    const csv = new TextEncoder().encode("name,role\nAva,facilitator\nScout,researcher\n");
    const r = await conv.convert(csv, "csv");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.markdown).toContain("name");
      expect(r.markdown).toContain("facilitator");
      expect(r.markdown).toContain("|"); // markdown 表格
    }
  });

  it("结构坏掉的字节 → ok:false 且 code 是封闭枚举之一（不抛原生 Error）", async () => {
    // 假 PNG 头当 pdf 转——anydoc 报结构性失败；关键是被收敛成 ok:false，不外泄异常。
    const junk = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const r = await conv.convert(junk, "pdf");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(["unsupported", "malformed", "encrypted", "resourceLimit", "missingPart", "io"])
        .toContain(r.code);
    }
  });
});
