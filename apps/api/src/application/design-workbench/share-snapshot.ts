/**
 * 迭代 22 —— 发布快照：**发布出去的那一份**，以及"它和现在的画布还一不一样"。
 *
 * 单独一个文件是为了不让 `project-shared.ts`（投影）与 `share-project.ts`（用例）互相 import：
 * 投影要算 `stale`，用例要造快照，两边都只依赖这里。
 *
 * ## 为什么发布的是快照
 *
 * 原型是**分页渐进落库**的（`append-project-chat.ts` 的 `persistProgress` 每画完一页写一次库）。
 * 一条"活"的分享链接意味着评审在你重新生成的那三十秒里刷新一下，看到的是三页空白加一页
 * 画到一半的稿。发布 = 冻结这一刻；之后画布怎么改都不影响已经发出去的那一份。
 *
 * 代价是快照会过期——而这个代价**必须说出来**，否则界面上留下的"已分享"就是本仓点名过的
 * 那种「静态痕迹」：写下来就不再变，而事实早就变了。`isShareStale` 就是把它变回动态信号。
 */
import type { designPrototype } from "@repo/contracts";
import { designWorkbench } from "@repo/contracts";
import type { DesignProjectRow } from "./project-ports";

/**
 * 冻结下来的那一份。
 *
 * ⚠ 含 `problem`/`criteria` 是**刻意**的，即使当前 `scope` 是 `prototype`（那档不对外返回
 *   它们）：快照记的是"发布那一刻这个项目长什么样"，而 scope 是"这一刻决定给看多少"。
 *   两者分开，切档才不需要重新解释"那我之前发的到底冻住了什么"。对外那一层由
 *   `SharedDesign` 的字段闭集把关（契约里那条断言），不靠这里少存几个字段。
 */
export interface ShareSnapshot {
  readonly name: string;
  readonly template: designWorkbench.ProjectTemplate;
  readonly theme: "light" | "dark";
  readonly accent: designWorkbench.PrototypeAccent;
  /**
   * 对标 R1（#3933）：设计 token。**只有不是缺省值时才写进快照**：这个字段之前发布的快照里没有它，
   * `isShareStale` 逐字比 JSON——无条件加上的话，所有老分享会在这次上线后一齐亮「已过期」，
   * 而访客看到的东西一个像素都没变。读侧缺它 ⇒ 缺省值。
   */
  readonly tokens?: designWorkbench.DesignTokens;
  readonly frames: readonly string[];
  readonly prototype: readonly (designPrototype.PrototypeNode | null)[];
  readonly frameNotes: readonly string[];
  readonly frameLinks: readonly (readonly designPrototype.PrototypeLink[])[];
  readonly problem: string;
  readonly criteria: readonly string[];
}

function isDefaultTokens(t: designWorkbench.DesignTokens | undefined): boolean {
  return t === undefined || JSON.stringify(t) === JSON.stringify(designWorkbench.DEFAULT_DESIGN_TOKENS);
}

/** 一行的当前样子 → 可发布的快照。读侧与写侧走**同一个函数**，否则 `stale` 会因为两边字段不一样而恒真。 */
export function shareSnapshotOf(row: DesignProjectRow): ShareSnapshot {
  return {
    name: row.name,
    template: row.template,
    theme: row.theme ?? "dark",
    accent: row.accent ?? "neutral",
    ...(isDefaultTokens(row.tokens) ? {} : { tokens: row.tokens! }),
    frames: [...row.frames],
    prototype: [...row.prototype],
    frameNotes: [...row.frameNotes],
    frameLinks: row.frameLinks.map((l) => [...l]),
    problem: row.problem,
    criteria: [...row.criteria],
  };
}

/**
 * 已发布的那一份与现在的画布是否已经不一样。
 *
 * 逐字段比**快照本身**，不是比 `updatedAt`：改个标签、推一次收件箱都会动 `updatedAt`，
 * 而访客看到的东西一个像素都没变——那样的 `stale` 会天天亮着，亮到没人再看它。
 */
export function isShareStale(snapshot: ShareSnapshot, row: DesignProjectRow): boolean {
  return JSON.stringify(snapshot) !== JSON.stringify(shareSnapshotOf(row));
}

/** 这个项目有没有**画出来的**页——一页都没有就没什么可发布的（契约 `NOTHING_TO_PUBLISH`）。 */
export function hasDrawnScreen(row: DesignProjectRow): boolean {
  return row.prototype.some((root) => root !== null && root !== undefined);
}
