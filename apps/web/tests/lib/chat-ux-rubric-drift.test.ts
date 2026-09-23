/**
 * 评测集的维度表**不得与验收文档分叉**。
 *
 * `.harness/instructions/chat-ux-acceptance-criteria.md` 是判据的唯一权威；
 * `e2e/support/chat-ux-rubric.ts` 只持有编号与短名（供报告可读）。两处都要有编号，
 * 这份副本消不掉——那就让它分叉时会红：文档加了第 11 项、或改了某一项的措辞主语，
 * 评测集必须跟着改，而不是继续按十项打分却少量一项。
 *
 * ⚠ 本仓已经因为「同一事实声明在两处」漂移过十一次，这是第十二处的预防。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DIMENSIONS } from "../../e2e/support/chat-ux-rubric";

const DOC = join(process.cwd(), "../../.harness/instructions/chat-ux-acceptance-criteria.md");

/** 从「## 十项打分维度」那一节里抽出 `N. **短名**：` 的编号与短名。 */
function docDimensions(): { id: number; name: string }[] {
  const text = readFileSync(DOC, "utf8");
  const start = text.indexOf("## 十项打分维度");
  expect(start, "验收文档里找不到「## 十项打分维度」一节——判据搬家了，评测集要跟着改")
    .toBeGreaterThan(-1);
  const section = text.slice(start, text.indexOf("\n## ", start + 10));
  return [...section.matchAll(/^(\d+)\.\s+\*\*([^*]+)\*\*/gm)]
    .map((m) => ({ id: Number(m[1]), name: (m[2] ?? "").trim() }));
}

describe("评测集维度 ↔ 验收文档", () => {
  it("文档里确实有十项（读不到时下面两条会拿空集互比，反而恒绿）", () => {
    expect(docDimensions()).toHaveLength(10);
  });

  it("编号集合一致", () => {
    expect(docDimensions().map((d) => d.id)).toEqual(DIMENSIONS.map((d) => d.id));
  });

  it("短名逐字一致——措辞改了就是判据改了，评测集不能还按旧的量", () => {
    expect(docDimensions().map((d) => d.name)).toEqual(DIMENSIONS.map((d) => d.name));
  });
});
