/**
 * 项目中枢 B3-T5（#4499）—— 观察者读项目证据时的脱敏，**唯一**判据。
 *
 * `usecases.md` 明确禁止观察者看的是原始转写与私聊。证据单元（`ProjectEvidenceItem`）把
 * 六类来源归一成「谁说的 + 摘录 + 位置」，其中「谁说的」（`speakerLabel`）与「说了什么」的
 * 全文（`excerpt`，≤ 280 字）正是观察者不该逐字看到的那部分。位置（`locator`）与材料标题
 * 不脱敏——观察者知道「第 3 段有一条证据」是合法的，知道「是谁在第 3 段说了整整一句什么」
 * 不是。
 *
 * ## 接线点（T1 的 `list-project-evidence.ts` / `get-project-evidence.ts`）
 *
 * 用例在 `authorize()` 拿到 `decision` 之后、返回之前 map 一次：
 * `items.map((it) => redactEvidenceForRole(it, decision.projectLayer?.role ?? null))`。
 * 判据只在这里一份——用例里不再出现 `role === "observer"` 这样的分支，否则两个用例各判一遍
 * 迟早漂移（本仓五次「同一事实两处声明」的老路）。
 *
 * ## 为什么是纯函数、放在 domain/
 *
 * 它不读库、不判权（谁是观察者由 `authorize()` 决定），只把一个已判定的角色映射成一条证据
 * 该长什么样。放 domain 让它能被直接单测（`tests/project/evidence-redaction.test.ts`），
 * 而不用起一个用例、喂一套假仓储才能看见「观察者拿到的 excerpt 被截了」。
 */
import type { projectEvidence as C } from "@repo/contracts";
import type { z } from "zod";
import type { ProjectRole } from "../identity/roles";

export type ProjectEvidenceItem = z.infer<typeof C.ProjectEvidenceItem>;

/** 观察者可见的摘录长度（字，按码点计，不是 UTF-16 单元）。超出的部分换成一个「…」。 */
export const OBSERVER_EXCERPT_LIMIT = 80;

/** 截断标记。与界面上其它「省略」保持同一个字符（U+2026），不是三个句点。 */
export const EXCERPT_ELLIPSIS = "…";

/**
 * 观察者视角：`speakerLabel` 抹成 `null`，`excerpt` 截到 `OBSERVER_EXCERPT_LIMIT` 字加「…」，
 * `locator` 与其余字段原样。非观察者（含 `null`：无项目角色——那种情形本就到不了这里，
 * `authorize()` 早已拒绝）返回**同一个对象**，不复制。
 *
 * ⚠ 恰好 80 字不截：截断只在「有东西被藏起来」时发生，一个刚好 80 字的摘录加上「…」
 *   会让读者以为后面还有——而后面没有。
 */
export function redactEvidenceForRole(item: ProjectEvidenceItem, role: ProjectRole | null): ProjectEvidenceItem {
  if (role !== "observer") return item;
  return {
    ...item,
    speakerLabel: null,
    excerpt: truncateExcerpt(item.excerpt),
  };
}

function truncateExcerpt(excerpt: string): string {
  const chars = Array.from(excerpt);
  if (chars.length <= OBSERVER_EXCERPT_LIMIT) return excerpt;
  return chars.slice(0, OBSERVER_EXCERPT_LIMIT).join("") + EXCERPT_ELLIPSIS;
}
