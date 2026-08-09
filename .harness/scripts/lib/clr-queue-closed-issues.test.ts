/**
 * clr-queue-closed-issues.test.ts —— #823 的直接产物：统一队列里不许有已关闭的 issue。
 *
 * ## 为什么这道门值得存在（它抓到过一个真实事故，不是假想的）
 *
 * 2026-08-09，`core-loop-readiness.json` 的 `blocking_issues` 里挂着 #627/#552——
 * 两个**早已关闭、修复早已合并**的 issue。它们是照着 `core-loop.spec.ts` 的过期注释
 * 播下去的。后果不是"多两行噪音"：统一队列是**所有 agent 的唯一取活口**，带死条目
 * 意味着有人会去做一件已经做完的事——实际发生的是，评分员差点照着这份清单把两个
 * 早已可用的维度打成 0 分。
 *
 * 这道门实现后第一次运行就在 main 上抓到了这两条，是"抓到活的"而不是"造出来的反证"。
 *
 * ## 这里测的是纯判定，不是 gh
 *
 * `findClosedQueueIssues` 里唯一的 I/O 是 `gh issue list`。把网络查询塞进单测既慢又脆，
 * 所以这里测的是**判定规则本身**（同 `core-loop-readiness.ts` 与 doctor 的分界：
 * 纯函数可穷举，I/O 不可）。三条规则各配一对用例。
 */
import { describe, expect, it } from "vitest";

/** 与 `core-loop-readiness-doctor.ts` 里同名逻辑一致的纯判定部分，抽出来可测。 */
export function selectDeadEntries(
  queue: readonly number[],
  closedIds: readonly number[] | null,
): number[] | null {
  if (queue.length === 0) return [];
  if (closedIds === null) return null;           // 查不到
  if (closedIds.length === 0) return null;       // 一条都没查到 ⇒ 更像查询失败
  const closed = new Set(closedIds);
  return queue.filter((n) => closed.has(n));
}

describe("统一队列的死条目判定（#823）", () => {
  it("反证：队列里有已关闭的 issue ⇒ 挑出来（这正是 2026-08-09 的真实事故）", () => {
    expect(selectDeadEntries([660, 619, 627, 552, 624], [627, 552, 617, 645])).toEqual([627, 552]);
  });

  it("不误伤：队列全是 OPEN ⇒ 空数组（门不能恒红）", () => {
    expect(selectDeadEntries([660, 619, 624], [627, 552, 617])).toEqual([]);
  });

  it("保序：多个死条目按队列原顺序返回，便于人照着删", () => {
    expect(selectDeadEntries([1, 2, 3, 4], [4, 2])).toEqual([2, 4]);
  });

  it("空队列 ⇒ 空数组，不去查网络", () => {
    expect(selectDeadEntries([], null)).toEqual([]);
  });

  it("⚠ 查不到（gh 失败）⇒ null，不是空数组——「问不到」不等于「没问题」", () => {
    expect(selectDeadEntries([660], null)).toBeNull();
  });

  it("⚠ 一条 closed 都没查到 ⇒ 也当查询失败（真实仓库不可能零关闭 issue）", () => {
    // 这条是防"gh 返回空但退出码 0"这种静默失败：若当成"查了、没死条目"，
    // 门就会在一个坏掉的环境里恒绿——那是空转，比没有门更糟。
    expect(selectDeadEntries([660], [])).toBeNull();
  });

  it("null 与 [] 的语义差别必须被调用方看见：null 走「跳过并明说」，[] 走「通过」", () => {
    const cannotTell = selectDeadEntries([660], null);
    const clean = selectDeadEntries([660], [999]);
    expect(cannotTell).toBeNull();
    expect(clean).toEqual([]);
    expect(cannotTell).not.toEqual(clean); // 两者不得被写成同一个分支
  });
});
