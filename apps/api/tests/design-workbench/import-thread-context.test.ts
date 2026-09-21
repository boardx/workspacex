/**
 * 迭代 16（#3773 R3）—— 「从 chat session 拿上下文」这条路上两个纯判断：
 * 截断怎么取、验收标准怎么过契约。都是免 DB 的纯函数，与生命周期用例分开跑。
 */
import { describe, expect, it } from "vitest";
import { designWorkbench as C } from "@repo/contracts";
import {
  IMPORT_HEAD_MESSAGES,
  parseImportedCriteria,
  selectImportMessages,
} from "../../src/application/design-workbench/import-thread";
import type { ChatMessageRow } from "../../src/application/chat/ports";

const msg = (i: number): ChatMessageRow => ({ body: `第 ${String(i)} 条` } as unknown as ChatMessageRow);

describe("导入截断首尾兼顾", () => {
  it("不超上限 ⇒ 原样全给，不标截断", () => {
    const all = Array.from({ length: C.IMPORT_THREAD_MAX_MESSAGES }, (_, i) => msg(i));
    const out = selectImportMessages(all);
    expect(out.truncated).toBe(false);
    expect(out.messages).toHaveLength(all.length);
    expect(out.omittedAfter).toBeUndefined();
  });

  it("超了 ⇒ **最早的几条也留着**，不是只取最近 N 条", () => {
    // ⭐ 反证锚点：改回 `all.slice(-N)` ⇒ 这条红。开头几条通常是需求原文，
    // 只取尾部的实际表现是"摘要读完不知道这是个什么产品"。
    const all = Array.from({ length: C.IMPORT_THREAD_MAX_MESSAGES + 30 }, (_, i) => msg(i));
    const out = selectImportMessages(all);
    expect(out.truncated).toBe(true);
    expect(out.messages).toHaveLength(C.IMPORT_THREAD_MAX_MESSAGES);
    expect(out.messages.slice(0, IMPORT_HEAD_MESSAGES).map((m) => m.body)).toEqual(
      all.slice(0, IMPORT_HEAD_MESSAGES).map((m) => m.body),
    );
    // 尾部仍然是最近的那些——后面的结论该赢，这一点没有变。
    expect(out.messages[out.messages.length - 1]?.body).toBe(all[all.length - 1]?.body);
    expect(out.omittedAfter).toBe(IMPORT_HEAD_MESSAGES);
  });
});

describe("抽出来的验收标准逐条过契约", () => {
  it("正常几条 ⇒ 原样带回（去掉首尾空白）", () => {
    expect(parseImportedCriteria(["  导出成功率 ≥ 99%  ", "历史会话可回看"])).toEqual([
      "导出成功率 ≥ 99%", "历史会话可回看",
    ]);
  });
  it("不是数组 / 空串 / 非字符串 / 超长 ⇒ 丢掉那一条，不整批拒", () => {
    expect(parseImportedCriteria("一段话")).toEqual([]);
    expect(parseImportedCriteria([1, "", "   ", "有效的一条", "x".repeat(300)])).toEqual(["有效的一条"]);
  });
  it("超过上限 ⇒ 截到上限", () => {
    const many = Array.from({ length: C.IMPORT_THREAD_MAX_CRITERIA + 5 }, (_, i) => `第 ${String(i)} 条口径`);
    expect(parseImportedCriteria(many)).toHaveLength(C.IMPORT_THREAD_MAX_CRITERIA);
  });
  it("抽不到 ⇒ 空数组（**不编**：编出来的一条会一路走到排期里去）", () => {
    expect(parseImportedCriteria(undefined)).toEqual([]);
    expect(parseImportedCriteria([])).toEqual([]);
  });
});
