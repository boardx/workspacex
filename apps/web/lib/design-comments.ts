/**
 * 对标 R8（#3933）—— 钉在元素上的批注。
 *
 * ## 它解决什么
 *
 * 看一版原型，人脑子里的意见是一条一条、**对着某个元素**的：「这个按钮再醒目一点」「评价放第一个」。
 * 在这之前只能把它们挨个翻译成对话：先点选一个元素、再打一句、等 AI 改完、再点下一个——
 * 五条意见等五轮。Claude Design 的做法是先在画布上把意见都钉好，再**一次**交给 AI 改。
 *
 * ## 为什么存在浏览器里、不进项目
 *
 * 批注是**给 AI 的待办**，不是设计本身：交出去之后它的内容已经变成对话里的一条消息（有记录、
 * 可回看），剩下的只是「哪些还没交」这点状态。为这点状态加一张表、一套接口与迁移，换来的是
 * 「换台电脑也看得到自己没交的批注」——值得做，但不是这一轮的差距。存储失败（隐私模式、配额满）
 * 就当内存里的，不打断任何事。
 */
import * as React from "react";

export interface DesignComment {
  readonly id: string;
  /** 钉在哪个节点上（项目内唯一）。 */
  readonly nodeId: string;
  /** 在第几页——换页后只显示当前页的钉。 */
  readonly frameIndex: number;
  /** 写批注那一刻这个节点叫什么（`prototypeNodeLabel`）——节点被删了，列表里仍认得出说的是谁。 */
  readonly label: string;
  readonly text: string;
  /** 已经交给 AI 了。 */
  readonly resolved: boolean;
}

const KEY = (projectId: string) => `wsx-design-comments:${projectId}`;
export const DESIGN_COMMENT_MAX_CHARS = 300;

export function loadComments(projectId: string): readonly DesignComment[] {
  try {
    const raw = window.localStorage.getItem(KEY(projectId));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DesignComment[]).filter((c) => typeof c?.id === "string" && typeof c?.nodeId === "string" && typeof c?.text === "string") : [];
  } catch {
    return [];
  }
}

export function saveComments(projectId: string, list: readonly DesignComment[]): void {
  try { window.localStorage.setItem(KEY(projectId), JSON.stringify(list)); } catch { /* 存不下就只在内存里，见文件头 */ }
}

/**
 * 把几条批注合成**一条**对话消息。每条带节点 id——模型据它用 patch 按 id 改那个节点
 * （`PROTOTYPE_PATCH_GUIDE`），而不是整页重画；带上当时的标签，是为了让人读对话记录时也看得懂。
 */
export function composeCommentsMessage(list: readonly DesignComment[], frames: readonly string[]): string {
  const lines = list.map((c, i) => `${i + 1}. 第 ${c.frameIndex + 1} 页「${frames[c.frameIndex] ?? ""}」的${c.label}（节点 id: ${c.nodeId}）：${c.text}`);
  return [`请按下面 ${list.length} 条批注修改原型（每条对应画布上的一个元素，按节点 id 局部修改，不要整页重画）：`, ...lines].join("\n");
}

export function useDesignComments(projectId: string | null) {
  const [comments, setComments] = React.useState<readonly DesignComment[]>([]);
  React.useEffect(() => { setComments(projectId === null ? [] : loadComments(projectId)); }, [projectId]);
  const update = (fn: (prev: readonly DesignComment[]) => readonly DesignComment[]) => {
    setComments((prev) => {
      const next = fn(prev);
      if (projectId !== null) saveComments(projectId, next);
      return next;
    });
  };
  return {
    comments,
    add: (c: Omit<DesignComment, "id" | "resolved">) =>
      update((prev) => [...prev, { ...c, text: c.text.slice(0, DESIGN_COMMENT_MAX_CHARS), id: `c-${Date.now().toString(36)}-${prev.length}`, resolved: false }]),
    remove: (id: string) => update((prev) => prev.filter((c) => c.id !== id)),
    resolve: (ids: readonly string[]) => update((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, resolved: true } : c))),
    clearResolved: () => update((prev) => prev.filter((c) => !c.resolved)),
  } as const;
}

