"use client";
import * as React from "react";

/**
 * AI 消息里的围栏代码块（```lang … ```）——**默认折叠**，用户点「显示代码」再展开。
 *
 * 动机（人类 2026-09-02 反馈）：跑 pdf / pptx / docx / xlsx 这类 skill 时，模型把生成
 * 文件用的整段脚本原样贴在回复里，几十行 `require('pdf-lib')` 把真正要看的那一句
 * 「PDF 这就生成」挤到看不见。代码是产出过程的副产品，不是给用户读的内容——足够长
 * 的围栏默认收起，只留一行摘要（语言 + 行数）和展开/复制入口。
 *
 * 为什么做在 `pre` 这一层而不是按「是否 skill 消息」判断：
 *   围栏源码只在最终 markdown 文本里，消息上没有「这段来自哪个 skill」的稳定标记；
 *   而不管来自哪里，一段长代码在聊天气泡里的默认形态都该是「可展开的摘要」。
 *   行内 `code`（如 `pnpm harness verify`）不经过 `pre`，不受影响。
 *
 * 折叠阈值（review #2556 反馈②）：只折叠超过 `COLLAPSE_THRESHOLD_LINES` 行的围栏——
 * 一条 `pnpm i` 之类的短命令块直接展开显示，不因为「统一走这一层」就连普通技术问答
 * 里的单行/短代码块也默认藏起来。阈值以下仍然渲成同一套「摘要条 + 复制」外壳，只是
 * 默认态是展开，用户仍可手动收起。
 *
 * 流式更新（review #2556 二轮反馈②）：同一条消息流式增量时，`children` 会不断换成
 * 更长（或更短）的内容，同一个 `ChatCodeFence` 实例始终挂载着——折叠态不能只在
 * `useState` 初始值里算一次。语义：**用户没有手动切换过时，折叠态跟着阈值实时走**
 * （行数从 ≤8 涨到 >8 要自动收起，反过来也一样）；**用户一旦点过「显示/隐藏代码」，
 * 之后的流式更新不再覆盖 ta 的选择**——不然用户刚展开看代码，下一个 chunk 到达就把
 * ta 手动打开的面板重新收起，体验上等于没给用户控制权。
 *
 * mermaid / canvas / persona 围栏在 `MarkdownMessage.segment` 里已经先于 markdown
 * 分支被抽走，永远到不了这里；这里只接普通语言的围栏。
 */

const COLLAPSE_THRESHOLD_LINES = 8;

/** 从 react-markdown 交给 `pre` 的 children 里取出 `<code className="language-xxx">`。 */
function readCodeChild(children: React.ReactNode): { lang: string | null; text: string } {
  const child = React.Children.toArray(children)[0];
  if (!React.isValidElement(child)) return { lang: null, text: flattenText(children) };
  const props = child.props as { className?: string; children?: React.ReactNode };
  const match = /language-([\w-]+)/.exec(props.className ?? "");
  return { lang: match?.[1] ?? null, text: flattenText(props.children) };
}

function flattenText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (React.isValidElement(node)) {
    return flattenText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

function countLines(text: string): number {
  const trimmed = text.replace(/\n$/, "");
  return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
}

/** 复制按钮的可见状态：区分「真的复制成功」和「API 不可用/被拒绝」，不假装成功。 */
type CopyState = "idle" | "copied" | "failed";

const COPY_LABEL: Record<CopyState, string> = {
  idle: "复制",
  copied: "已复制",
  failed: "复制失败",
};

export function ChatCodeFence({ children }: React.ComponentPropsWithoutRef<"pre">) {
  const { lang, text } = React.useMemo(() => readCodeChild(children), [children]);
  const lines = countLines(text);
  const autoOpen = lines <= COLLAPSE_THRESHOLD_LINES;
  // `null` = 用户还没手动切换过，折叠态跟着 `autoOpen` 走（流式增量场景）；
  // 一旦用户点过 toggle，这里存的是 ta 的选择，往后的流式更新不再覆盖它。
  const [userOpen, setUserOpen] = React.useState<boolean | null>(null);
  const open = userOpen ?? autoOpen;

  const [copyState, setCopyState] = React.useState<CopyState>("idle");
  // 复制状态的自动复位计时器：并发/连点复制时只保留最后一次，避免旧计时器
  // 把新结果提前冲掉；卸载时清掉，避免给已卸载的消息挂着回调。
  const resetTimer = React.useRef<number | null>(null);
  // 「最新一次调用」令牌（review #2556 三轮反馈①）：`writeText()` 的 promise 不保证
  // 按调用顺序 settle——用户快速连点时，更早发出的一次可能反而更晚 resolve/reject，
  // 若每次调用各自无条件写 `copyState`，旧调用的结果会在新调用之后覆盖回去。每次
  // 调用领一个自增 id，settle 时只有「自己仍是最新一次」才允许落地状态与复位计时器；
  // 不是最新的一律丢弃结果（连状态都不设），旧调用发起的定时器已被新调用一并清掉。
  const latestCopyId = React.useRef(0);
  React.useEffect(() => () => {
    if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
  }, []);

  const scheduleReset = React.useCallback(() => {
    if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => {
      resetTimer.current = null;
      setCopyState("idle");
    }, 1500);
  }, []);

  const copy = React.useCallback(async () => {
    const id = ++latestCopyId.current;
    const applyIfLatest = (state: CopyState) => {
      if (latestCopyId.current !== id) return; // 更新的一次已经发起，这次结果作废。
      setCopyState(state);
      scheduleReset();
    };
    // `navigator.clipboard` 在非安全上下文（非 https/localhost）里整体不存在；
    // `writeText` 权限被拒绝时 promise reject。两种情况都不该报「已复制」。
    if (!navigator.clipboard?.writeText) {
      applyIfLatest("failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      applyIfLatest("copied");
    } catch {
      applyIfLatest("failed");
    }
  }, [text, scheduleReset]);

  return (
    <div
      data-testid="chat-code-fence"
      data-lang={lang ?? undefined}
      data-open={open ? "true" : "false"}
      className="overflow-hidden rounded-md border border-border-subtle bg-card"
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-11 text-muted-foreground">
        <span className="font-mono">{lang ?? "code"}</span>
        <span>· {lines} 行</span>
        <span className="flex-1" />
        <button
          type="button"
          data-testid="chat-code-fence-copy"
          onClick={copy}
          className="rounded-sm px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-card-foreground"
        >
          {/* aria-live：复制是否成功对屏幕阅读器不是视觉可见的状态变化，需要主动播报。 */}
          <span aria-live="polite">{COPY_LABEL[copyState]}</span>
        </button>
        <button
          type="button"
          data-testid="chat-code-fence-toggle"
          aria-expanded={open}
          onClick={() => setUserOpen(!open)}
          className="rounded-sm px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-card-foreground"
        >
          {open ? "隐藏代码" : "显示代码"}
        </button>
      </div>
      {open ? (
        <pre className="!mt-0 !rounded-none !border-0 !border-t !border-border-subtle">{children}</pre>
      ) : null}
    </div>
  );
}
