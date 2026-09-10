/**
 * issue #3356 —— 分页合并的边界。
 *
 * 这些是**纯函数**断言，跑得快、边界写得准；「首屏只取 30 条」「服务端没多拉」
 * 那一层的判据在 `apps/api/tests/chat/personal-thread-list-pagination.test.ts`
 * （真栈 HTTP + PostgreSQL）——那一条才是需求「不要一次全部加载出来」的判据，
 * 这里判的是拿到页之后**怎么拼**。
 */
import { describe, expect, it } from "vitest";
import { appendThreadPage, countCards, hasMorePages, refreshLimit, THREAD_PAGE_SIZE } from "@/lib/chat-workbench/thread-pages";
import type { ListPersonalThreadsOut } from "@/lib/live-chat";

const card = (id: string) => ({
  id, title: id, subtitle: "", badges: [], status: "done" as const,
  artifactCount: 0, lastActivityAt: "2026-09-01T00:00:00.000Z",
  visibilityScope: "private" as const, pinned: false,
});

const list = (
  groups: { label: string; cards: string[] }[],
  nextCursor: string | null,
): ListPersonalThreadsOut =>
  ({ groups: groups.map((g) => ({ label: g.label, cards: g.cards.map(card) })), capabilities: ["thread.mutate"], nextCursor }) as ListPersonalThreadsOut;

const shape = (out: ListPersonalThreadsOut) => out.groups.map((g) => [g.label, g.cards.map((c) => c.id)]);

describe("appendThreadPage —— 分页边界横跨分组", () => {
  it("同名组追加进同一组，不再多出一个重复的组头", () => {
    // 第一页在「本周」中途断掉，第二页从「本周」剩下的接着来，然后进入「更早」。
    const merged = appendThreadPage(
      list([{ label: "今天", cards: ["a"] }, { label: "本周", cards: ["b", "c"] }], "cur-1"),
      list([{ label: "本周", cards: ["d"] }, { label: "更早", cards: ["e"] }], null),
    );
    expect(shape(merged)).toEqual([
      ["今天", ["a"]],
      ["本周", ["b", "c", "d"]], // 不是两个「本周」组头
      ["更早", ["e"]],
    ]);
    expect(merged.groups.filter((g) => g.label === "本周")).toHaveLength(1);
  });

  it("新一页的 nextCursor 覆盖旧的——否则「加载更多」会永远停在同一页", () => {
    const merged = appendThreadPage(list([{ label: "今天", cards: ["a"] }], "cur-1"), list([{ label: "今天", cards: ["b"] }], "cur-2"));
    expect(merged.nextCursor).toBe("cur-2");
    expect(hasMorePages(merged)).toBe(true);
    expect(hasMorePages(appendThreadPage(merged, list([{ label: "今天", cards: ["c"] }], null)))).toBe(false);
  });

  it("兜底去重：新一页里混进已加载过的 id ⇒ 只保留一份，不产生 duplicate key", () => {
    const merged = appendThreadPage(
      list([{ label: "今天", cards: ["a", "b"] }], "cur-1"),
      list([{ label: "今天", cards: ["b", "c"] }], null),
    );
    expect(shape(merged)).toEqual([["今天", ["a", "b", "c"]]]);
    expect(countCards(merged)).toBe(3);
  });

  it("已加载的那份一个字节都不动（返回新对象，不就地改）", () => {
    const loaded = list([{ label: "今天", cards: ["a"] }], "cur-1");
    const before = JSON.stringify(loaded);
    appendThreadPage(loaded, list([{ label: "今天", cards: ["b"] }], null));
    expect(JSON.stringify(loaded)).toBe(before);
  });
});

describe("hasMorePages —— 「加载更多」入口显隐的唯一判据", () => {
  it("翻到底 ⇒ false（入口不渲染，不是渲染一个点了没反应的按钮）", () => {
    expect(hasMorePages(list([{ label: "今天", cards: ["a"] }], null))).toBe(false);
  });
  it("还没开始加载（null 列表）⇒ false，不在骨架期猜有没有下一页", () => {
    expect(hasMorePages(null)).toBe(false);
  });
  it("字段缺失（项目对话那条不分页的链路 / 旧响应体）⇒ 与「没有下一页」同解", () => {
    expect(hasMorePages({ groups: [], capabilities: [] } as unknown as ListPersonalThreadsOut)).toBe(false);
  });
});

describe("refreshLimit —— 保鲜刷新不把用户翻出来的页缩回去", () => {
  it("只加载了首屏 ⇒ 刷新仍然只要一页", () => {
    expect(refreshLimit(list([{ label: "今天", cards: ["a"] }], "c"))).toBe(THREAD_PAGE_SIZE);
    expect(refreshLimit(null)).toBe(THREAD_PAGE_SIZE);
  });

  it("翻了三页（90 条）⇒ 刷新要 90 条，不是 30——否则每 10 秒列表自己塌一次", () => {
    const ids = Array.from({ length: 90 }, (_, i) => `t${i}`);
    expect(refreshLimit(list([{ label: "更早", cards: ids }], "c"))).toBe(90);
  });

  it("翻得很深 ⇒ 封顶 300，保鲜不会退化成「每 10 秒一次全量拉取」", () => {
    const ids = Array.from({ length: 900 }, (_, i) => `t${i}`);
    expect(refreshLimit(list([{ label: "更早", cards: ids }], "c"))).toBe(300);
  });
});
