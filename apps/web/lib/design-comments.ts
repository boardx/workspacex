/**
 * 对标 R8（#3933）—— 钉在元素上的批注；深度 S2（#3988）起**存在服务端**。
 *
 * ## 它解决什么
 *
 * 看一版原型，人脑子里的意见是一条一条、**对着某个元素**的：「这个按钮再醒目一点」「评价放第一个」。
 * 在这之前只能把它们挨个翻译成对话：先点选一个元素、再打一句、等 AI 改完、再点下一个——
 * 五条意见等五轮。Claude Design 的做法是先在画布上把意见都钉好，再**一次**交给 AI 改。
 *
 * ## 为什么从浏览器搬到服务端（S2）
 *
 * R8 把批注当成「给 AI 的待办」，只存在本机。实际它是给**人**看的：同事打开同一个项目要看得到、
 * 换台电脑要看得到、清一次缓存不能丢——本机存储一条都做不到（深度评测 V1）。所以状态唯一的
 * 事实源是服务端；这里只是它在页面上的一份读数，每个动作都等服务端回话再改屏上那份。
 *
 * R8 时写在本机的旧批注：打开项目时**上传一次**再从本机删掉（`LEGACY_KEY`），不让它们凭空消失。
 */
import * as React from "react";
import { designWorkbench } from "@repo/contracts";
import {
  createDesignComment,
  deleteDesignComment,
  listDesignComments,
  replyToDesignComment,
  setDesignCommentResolved,
  type DesignComment,
} from "@/lib/live-design-workbench";
import { describeFailure } from "@/lib/design-failure";

export type { DesignComment };
/** 单源：契约 `DESIGN_COMMENT_MAX_CHARS`（库里的 CHECK 同值）。 */
export const DESIGN_COMMENT_MAX_CHARS = designWorkbench.DESIGN_COMMENT_MAX_CHARS;

/** R8 时本机存储的键。只用于一次性上传旧批注，之后不再写。 */
const LEGACY_KEY = (projectId: string) => `wsx-design-comments:${projectId}`;

interface LegacyComment { nodeId: string; frameIndex: number; label: string; text: string; resolved?: boolean }

/** 读出 R8 写在本机的批注（坏数据读成空）。只有未交给 AI 的才值得搬。 */
export function loadLegacyComments(projectId: string): readonly LegacyComment[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY(projectId));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as LegacyComment[]).filter((c) => typeof c?.nodeId === "string" && typeof c?.text === "string" && typeof c?.frameIndex === "number" && c.resolved !== true)
      : [];
  } catch {
    return [];
  }
}

/**
 * 一次性上传进行中的那一份——开发模式下 effect 会跑两遍（StrictMode），两遍各传一次就重复了。
 * 同一个项目共用同一个 promise；传完从表里拿掉。
 */
const legacyUploads = new Map<string, Promise<void>>();
function uploadLegacyOnce(projectId: string): Promise<void> {
  const running = legacyUploads.get(projectId);
  if (running !== undefined) return running;
  const legacy = loadLegacyComments(projectId);
  if (legacy.length === 0) return Promise.resolve();
  const job = (async () => {
    for (const c of legacy) {
      await createDesignComment(projectId, { nodeId: c.nodeId, frameIndex: c.frameIndex, label: (c.label ?? "").slice(0, 200), text: c.text.slice(0, DESIGN_COMMENT_MAX_CHARS) });
    }
    dropLegacy(projectId);
  })().finally(() => legacyUploads.delete(projectId));
  legacyUploads.set(projectId, job);
  return job;
}

function dropLegacy(projectId: string): void {
  try { window.localStorage.removeItem(LEGACY_KEY(projectId)); } catch { /* 清不掉就留着：下次再搬一遍会重复，所以只在全部搬完后才清 */ }
}

/**
 * 把几条批注合成**一条**对话消息。每条带节点 id——模型据它用 patch 按 id 改那个节点
 * （`PROTOTYPE_PATCH_GUIDE`），而不是整页重画；带上当时的标签，是为了让人读对话记录时也看得懂。
 */
export function composeCommentsMessage(list: readonly Pick<DesignComment, "nodeId" | "frameIndex" | "label" | "text">[], frames: readonly string[]): string {
  const lines = list.map((c, i) => `${i + 1}. 第 ${c.frameIndex + 1} 页「${frames[c.frameIndex] ?? ""}」的${c.label}（节点 id: ${c.nodeId}）：${c.text}`);
  return [`请按下面 ${list.length} 条批注修改原型（每条对应画布上的一个元素，按节点 id 局部修改，不要整页重画）：`, ...lines].join("\n");
}

export function useDesignComments(projectId: string | null) {
  const [comments, setComments] = React.useState<readonly DesignComment[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setComments([]);
    setError(null);
    if (projectId === null) return;
    let alive = true;
    void (async () => {
      try {
        await uploadLegacyOnce(projectId);
        const res = await listDesignComments(projectId);
        // 读回来的不是一个列表（接口还没上线、被代理改写）⇒ 当作没有批注，不能让整个详情页崩掉。
        if (alive) setComments(Array.isArray(res?.items) ? res.items : []);
      } catch (err) {
        if (alive) setError(`批注没能读出来（${describeFailure(err)}）`);
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  /** 每个写动作：等服务端回话再改屏上那份；失败就说出来，屏上不变。 */
  const guard = async (what: string, fn: () => Promise<void>): Promise<boolean> => {
    try {
      await fn();
      setError(null);
      return true;
    } catch (err) {
      setError(`没能${what}（${describeFailure(err)}）`);
      return false;
    }
  };
  const replace = (c: DesignComment) => setComments((prev) => prev.map((x) => (x.id === c.id ? c : x)));

  return {
    comments,
    error,
    add: (c: { nodeId: string; frameIndex: number; label: string; text: string }) => projectId === null ? Promise.resolve(false) : guard("钉上这条批注", async () => {
      const { comment } = await createDesignComment(projectId, { ...c, label: c.label.slice(0, 200), text: c.text.slice(0, DESIGN_COMMENT_MAX_CHARS) });
      setComments((prev) => [...prev, comment]);
    }),
    remove: (id: string) => projectId === null ? Promise.resolve(false) : guard("删掉这条批注", async () => {
      await deleteDesignComment(projectId, id);
      setComments((prev) => prev.filter((c) => c.id !== id));
    }),
    setResolved: (id: string, resolved: boolean) => projectId === null ? Promise.resolve(false) : guard(resolved ? "标记解决" : "重新打开", async () => {
      replace((await setDesignCommentResolved(projectId, id, resolved)).comment);
    }),
    /** 深度 S3：回一句——服务端回整条批注（含全部回复），整条换掉。 */
    reply: (id: string, text: string) => projectId === null ? Promise.resolve(false) : guard("发出这条回复", async () => {
      replace((await replyToDesignComment(projectId, id, text.slice(0, DESIGN_COMMENT_MAX_CHARS))).comment);
    }),
    /** 交给 AI 改完之后逐条标已解决。 */
    resolve: (ids: readonly string[]) => projectId === null ? Promise.resolve(false) : guard("把批注标成已交给 AI", async () => {
      for (const id of ids) replace((await setDesignCommentResolved(projectId, id, true)).comment);
    }),
    /** 删掉已解决的——只删得掉自己写的（或自己是项目 owner）；删不掉的留着，说一句。 */
    clearResolved: () => projectId === null ? Promise.resolve(false) : guard("清掉已解决的批注", async () => {
      for (const c of comments.filter((x) => x.resolved)) {
        await deleteDesignComment(projectId, c.id);
        setComments((prev) => prev.filter((x) => x.id !== c.id));
      }
    }),
  } as const;
}
