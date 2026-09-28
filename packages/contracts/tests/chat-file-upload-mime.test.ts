import { describe,expect,it } from "vitest";
import { normalizeAttachmentMime } from "../src/chat-file-upload";

describe("normalizeAttachmentMime",()=>{
  it("fills only absent browser MIME for Markdown and plain text",()=>{
    expect(normalizeAttachmentMime("研究.MD","")).toBe("text/markdown");
    expect(normalizeAttachmentMime("研究.TXT","")).toBe("text/plain");
    expect(normalizeAttachmentMime("研究.csv","")).toBe("");
    expect(normalizeAttachmentMime("研究.docx","")).toBe("");
    expect(normalizeAttachmentMime("README","")).toBe("");
  });
  it("never changes a nonempty declared MIME, even when it conflicts with the extension",()=>{
    expect(normalizeAttachmentMime("研究.md","application/pdf")).toBe("application/pdf");
    expect(normalizeAttachmentMime("研究.txt","text/plain; charset=utf-8")).toBe("text/plain; charset=utf-8");
    expect(normalizeAttachmentMime("研究.md"," ")).toBe(" ");
  });
});
