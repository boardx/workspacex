/**
 * issue #3727 —— `@文件名` 引用历史附件的解析规则（纯函数反证）。
 * 每条断言对应 devapp 实测的一个坏形态：@ 了上一轮截图却"/inputs 里没有"。
 */
import { describe, expect, it } from "vitest";
import {
  isAttachmentMentioned, mayMentionAttachments, selectRunScopedAttachments,
} from "../../src/domain/chat/attachment-mentions";

const row = (id: string, filename: string, message_id: string, created_at: string) => ({ id, filename, message_id, created_at });

describe("isAttachmentMentioned", () => {
  it("文件名含空格与点号也能整体匹配（composer 插入的是 `@<filename> `）", () => {
    expect(isAttachmentMentioned("@截屏2026-09-18 15.48.24.png 这个是截图，请重新计算", "截屏2026-09-18 15.48.24.png")).toBe(true);
  });
  it("只是前缀相同不算（`@a.png.bak` 不是 `a.png`）", () => {
    expect(isAttachmentMentioned("看 @a.png.bak 这个", "a.png")).toBe(false);
  });
  it("行尾 / 中文标点结尾都算引用", () => {
    expect(isAttachmentMentioned("请看 @报告.pdf", "报告.pdf")).toBe(true);
    expect(isAttachmentMentioned("请看 @报告.pdf，然后总结", "报告.pdf")).toBe(true);
  });
  it("正文没有 @ ⇒ 廉价预判为否，不去查历史附件", () => {
    expect(mayMentionAttachments("图里画了什么？")).toBe(false);
    expect(mayMentionAttachments("@x")).toBe(true);
  });
});

describe("selectRunScopedAttachments", () => {
  const body = "@截屏 A.png 和 @b.pdf 一起看";
  it("触发消息附件全部保留 + 正文点名的历史附件纳入；未点名的历史附件不纳入", () => {
    const rows = [
      row("att-now", "now.png", "msg-now", "2026-09-18T03:00:00Z"),
      row("att-a", "截屏 A.png", "msg-old", "2026-09-18T01:00:00Z"),
      row("att-b", "b.pdf", "msg-older", "2026-09-18T00:00:00Z"),
      row("att-c", "c.png", "msg-old", "2026-09-18T01:00:00Z"),
    ];
    expect(selectRunScopedAttachments(rows, "msg-now", body).map((r) => r.id)).toEqual(["att-now", "att-b", "att-a"]);
  });
  it("同名多份取最新一份", () => {
    const rows = [
      row("att-1", "截屏 A.png", "msg-1", "2026-09-18T01:00:00Z"),
      row("att-2", "截屏 A.png", "msg-2", "2026-09-18T02:00:00Z"),
    ];
    expect(selectRunScopedAttachments(rows, "msg-now", body).map((r) => r.id)).toEqual(["att-2"]);
  });
  it("触发消息里已有同名附件 ⇒ 历史那份不重复纳入", () => {
    const rows = [
      row("att-new", "b.pdf", "msg-now", "2026-09-18T03:00:00Z"),
      row("att-old", "b.pdf", "msg-old", "2026-09-18T01:00:00Z"),
    ];
    expect(selectRunScopedAttachments(rows, "msg-now", body).map((r) => r.id)).toEqual(["att-new"]);
  });
  it("没有 @ 的正文 ⇒ 只剩触发消息附件（无 @ 的 run 语义逐字不变）", () => {
    const rows = [row("att-now", "x.png", "msg-now", "2026-09-18T03:00:00Z"), row("att-old", "x2.png", "msg-old", "2026-09-18T01:00:00Z")];
    expect(selectRunScopedAttachments(rows, "msg-now", "图里画了什么？").map((r) => r.id)).toEqual(["att-now"]);
  });
});
