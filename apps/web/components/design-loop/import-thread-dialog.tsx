"use client";

/**
 * 迭代 13（design-delta `design-chat-inputs` §2）—— 「从对话导入」。
 *
 * ## 三步，而且第三步之前**什么都不写**
 *
 *   ① 选线程（复用 `listPersonalThreads` 的既有列表形态，不另造一份线程卡）
 *   ② 服务端摘一段回来，落进一个**可编辑**的文本框
 *   ③ 点「导入为背景」才写库
 *
 * 第 ③ 步这道门不是礼貌，是必要：导入写的是项目的 `problem`，而用户很可能已经在
 * 那里写了东西。选中即写 = 一次点击抹掉他自己写的背景，还没有撤销（V58）。
 * 关掉弹窗、按 Esc、选了线程又反悔——三条路都必须一个字不落库。
 *
 * ## 为什么列的是**个人线程**
 *
 * 设计工作台不在任何项目上下文里（它的 `:projectId` 是设计项目，不是 chat 的项目），
 * 而人类交办那句「我刚在 chat 里跟 AI 聊了半天需求」指的就是个人对话那条列表。
 * 项目线程要选的话，得先让用户选一个项目——那是另一个决定，不在本 delta 里发明。
 * ⚠ 真正的边界不在这份列表上：服务端对每条线程都过 `getThread` 那条鉴权（V56）。
 *   这里少列几条只是没给入口，不是权限；反过来说，列表里多出来的东西也进不去。
 */
import * as React from "react";
import { Loader2, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import { listPersonalThreads, type ThreadCard } from "@/lib/live-chat";
import { importThread, type DesignProject, type ImportedThread } from "@/lib/live-design-workbench";
import { useDialogFocus } from "./use-dialog-focus";

type Stage =
  | { kind: "picking" }
  /** 预览：服务端已经摘好一段，还没写库。`text` 是用户可以随便改的那份。 */
  | { kind: "preview"; thread: ThreadCard; imported: ImportedThread; text: string; truncated: boolean };

function describeFailure(err: unknown): string {
  if (err instanceof ApiError) {
    // 404 = 这条线程对你不可见（与"不存在"同一个出口，见契约 `importThread` 头注）。
    if (err.status === 404) return "读不到这条对话——它可能已经被删了，或者不是你的。";
    if (err.status === 503) return "这次没能把对话摘成背景（模型没回来）。可以再试一次。";
    return err.reasonCode ?? `http_${err.status}`;
  }
  if (err instanceof TypeError) return "无法连接服务器，请稍后重试";
  return String(err);
}

export function ImportThreadDialog({
  projectId,
  onClose,
  onImported,
}: {
  readonly projectId: string;
  readonly onClose: () => void;
  /** 只有真的写进去了才会调——预览阶段关掉弹窗不触发它。 */
  readonly onImported: (project: DesignProject) => void;
}) {
  /** B6.5：焦点进弹窗 / Esc 关闭 / 关掉之后焦点回到「从对话导入」那个按钮。 */
  const panelRef = React.useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef, onClose);
  const [threads, setThreads] = React.useState<readonly ThreadCard[] | null>(null);
  /**
   * issue #3356 —— `listPersonalThreads` 现在**默认只给一页（30 条）**：契约的
   * `limit` 省略即 30，不再是"省略即全部"。这个弹窗因此也得能翻下一页，否则一个
   * 有 187 条对话的用户在这里只看得到最近 30 条，而且**没有任何提示**说下面还有。
   *
   * 「还有没有下一页」同样只有服务端的 `nextCursor` 一个事实源——这里不数条数、
   * 不记页码。
   */
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [stage, setStage] = React.useState<Stage>({ kind: "picking" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const out = await listPersonalThreads({});
        // `listPersonalThreads` 返回的是**分好组**的列表（今天 / 本周 / 更早，服务端定的顺序）。
        // 这里按组的顺序摊平：一个选线程的弹窗不需要日期分隔，但也不该自己再排一次序
        // ——顺序是服务端的事实，前端 `sort()` 一下将来一分页就乱（同 V65 那条纪律）。
        if (alive) {
          setThreads(out.groups.flatMap((g) => g.cards));
          setNextCursor(out.nextCursor);
        }
      } catch (e) {
        if (alive) {
          setThreads([]);
          setError(describeFailure(e));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** issue #3356 —— 翻下一页并**追加**（去重兜底同 `thread-pages.ts` 那条理由）。 */
  const loadMore = async () => {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const out = await listPersonalThreads({ cursor: nextCursor });
      const incoming = out.groups.flatMap((g) => g.cards);
      setThreads((prev) => {
        const seen = new Set((prev ?? []).map((t) => t.id));
        return [...(prev ?? []), ...incoming.filter((t) => !seen.has(t.id))];
      });
      setNextCursor(out.nextCursor);
    } catch (e) {
      setError(describeFailure(e));
    } finally {
      setLoadingMore(false);
    }
  };

  /** 选中 ⇒ **预览**（不传 `problem`）。这一步服务端一个字不写。 */
  const pick = async (thread: ThreadCard) => {
    setBusy(true);
    setError(null);
    try {
      const out = await importThread(projectId, thread.id);
      setStage({ kind: "preview", thread, imported: out.imported, text: out.summary, truncated: out.truncated });
    } catch (e) {
      setError(describeFailure(e));
    } finally {
      setBusy(false);
    }
  };

  /** 确认 ⇒ 把**编辑之后**的这段交上去写入。 */
  const confirm = async () => {
    if (stage.kind !== "preview") return;
    setBusy(true);
    setError(null);
    try {
      const out = await importThread(projectId, stage.thread.id, stage.text);
      onImported(out.project);
      onClose();
    } catch (e) {
      setError(describeFailure(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="import-thread-dialog">
      <div className="absolute inset-0 bg-inverse/40" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="从对话导入"
        className="relative flex w-full max-w-lg flex-col gap-3 rounded-card border border-border bg-card p-5 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <h3 className="text-16 font-semibold">
          {stage.kind === "picking" ? "从对话导入" : "确认要导入的背景"}
        </h3>

        {stage.kind === "picking" && (
          <>
            <p className="text-11 text-muted-foreground">
              选一条聊过需求的对话，我把它这一刻的内容摘成这个项目的背景。之后那条对话再怎么聊，都不会再改这里。
            </p>
            {threads === null ? (
              <div className="flex items-center gap-1.5 py-6 text-12 text-muted-foreground" data-testid="import-thread-loading" role="status">
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> 正在读你的对话…
              </div>
            ) : threads.length === 0 ? (
              <p className="py-6 text-12 text-muted-foreground" data-testid="import-thread-empty">
                还没有可以导入的对话。先去对话里把需求聊清楚，再回来导。
              </p>
            ) : (
              <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto" data-testid="import-thread-list">
                {threads.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void pick(t)}
                      data-testid={`import-thread-item-${t.id}`}
                      className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors duration-fast hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-disabled-foreground"
                    >
                      <MessagesSquare aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-12">{t.title}</span>
                      <span className="shrink-0 text-10 text-muted-foreground">{t.lastActivityAt.slice(0, 10)}</span>
                    </button>
                  </li>
                ))}
                {/* 入口只在服务端说还有下一页时才在；到底之后**不渲染**，不留一个点了没反应的按钮。 */}
                {nextCursor !== null ? (
                  <li>
                    <button
                      type="button"
                      disabled={loadingMore}
                      onClick={() => void loadMore()}
                      data-testid="import-thread-load-more"
                      className="w-full rounded-control px-2 py-1.5 text-12 text-muted-foreground transition-colors duration-fast hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {loadingMore ? "加载中…" : "加载更多"}
                    </button>
                  </li>
                ) : null}
              </ul>
            )}
          </>
        )}

        {stage.kind === "preview" && (
          <>
            <p className="text-11 text-muted-foreground" data-testid="import-thread-source">
              来自《{stage.imported.title}》的 {stage.imported.messageCount} 条消息
              {/* 截断必须说出来：静默截断会让用户以为模型看过它其实没看过的那段 */}
              {stage.truncated && <span data-testid="import-thread-truncated">（对话更长，只读了最近这些）</span>}
            </p>
            <Textarea
              rows={10}
              value={stage.text}
              onChange={(e) => setStage({ ...stage, text: e.target.value })}
              aria-label="导入预览"
              data-testid="import-thread-preview"
            />
            <p className="text-10 text-muted-foreground">改完再确认——写进项目的是上面这段文字，不是原始对话。</p>
          </>
        )}

        {error !== null && (
          <p className="text-11 text-destructive" role="alert" data-testid="import-thread-error">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="import-thread-cancel">取消</Button>
          {stage.kind === "preview" && (
            <Button variant="primary" size="sm" disabled={busy || stage.text.trim() === ""} onClick={() => void confirm()} data-testid="import-thread-confirm">
              {busy && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />} 导入为背景
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
