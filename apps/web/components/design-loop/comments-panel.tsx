"use client";
/**
 * 对标 R8（#3933）—— 批注的两块界面：给选中元素写一句（`CommentComposer`），
 * 和「这一版的批注」列表 + 一次交给 AI（`CommentList`）。状态与合成消息在 `lib/design-comments`。
 */
import * as React from "react";
import { Check, MessageSquarePlus, Send, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DESIGN_COMMENT_MAX_CHARS, type DesignComment } from "@/lib/design-comments";

export function CommentComposer({ label, onSave, onCancel }: {
  readonly label: string;
  readonly onSave: (text: string) => void;
  readonly onCancel: () => void;
}): React.ReactElement {
  const [text, setText] = React.useState("");
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => { ref.current?.focus(); }, [label]);
  const save = () => { if (text.trim() !== "") { onSave(text.trim()); setText(""); } };
  return (
    <div className="flex flex-col gap-1.5 border-b border-border p-3" data-testid="design-comment-composer">
      <p className="text-10 text-muted-foreground">给 <span className="font-medium text-card-foreground">{label}</span> 写一句</p>
      <textarea
        ref={ref} rows={3} maxLength={DESIGN_COMMENT_MAX_CHARS} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === "Escape") onCancel(); }}
        placeholder="比如：这个按钮再醒目一点" aria-label="批注内容（回车保存）"
        data-testid="design-comment-input"
        className="w-full resize-none rounded-control border border-input bg-background px-2 py-1.5 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onCancel} className="rounded-control px-2 py-1 text-11 text-muted-foreground transition-colors duration-fast hover:bg-panel">算了</button>
        <button type="button" onClick={save} disabled={text.trim() === ""} data-testid="design-comment-save"
          className="inline-flex items-center gap-1 rounded-control bg-primary px-2 py-1 text-11 text-primary-foreground disabled:bg-disabled disabled:text-disabled-foreground">
          <MessageSquarePlus aria-hidden className="h-3 w-3" /> 钉上去
        </button>
      </div>
    </div>
  );
}

export function CommentList({ comments, frame, sending, onRemove, onSend, onClearResolved, onFocus }: {
  readonly comments: readonly DesignComment[];
  /** 当前页：别的页上的批注照样列出来（一次交出去的是全部），标一下在第几页。 */
  readonly frame: number;
  readonly sending: boolean;
  readonly onRemove: (id: string) => void;
  readonly onSend: () => void;
  readonly onClearResolved: () => void;
  readonly onFocus: (c: DesignComment) => void;
}): React.ReactElement {
  const open = comments.filter((c) => !c.resolved);
  const done = comments.filter((c) => c.resolved);
  return (
    <div className="flex min-h-0 flex-col gap-2 p-3" data-testid="design-comments">
      <p className="text-10 font-medium text-muted-foreground">
        批注（{open.length} 条待改{done.length > 0 ? `，${done.length} 条已交给 AI` : ""}）
      </p>
      {comments.length === 0 && <p className="text-11 text-muted-foreground">点画布上的任何一块，给它写一句意见。写完几条，一次交给 AI 改。</p>}
      <ol className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
        {comments.map((c) => (
          <li key={c.id} data-testid="design-comment-item" data-resolved={c.resolved ? "true" : undefined}
            className={cn("flex items-start gap-2 rounded-control border border-border p-2 text-11", c.resolved && "text-muted-foreground")}>
            <span aria-hidden className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-9 font-semibold", c.resolved ? "bg-success/20 text-success" : "bg-primary text-primary-foreground")}>
              {c.resolved ? <Check className="h-2.5 w-2.5" /> : open.indexOf(c) + 1}
            </span>
            <button type="button" onClick={() => onFocus(c)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-10 text-muted-foreground">{c.frameIndex !== frame ? `第 ${c.frameIndex + 1} 页 · ` : ""}{c.label}</span>
              <span className={cn("block break-words", c.resolved && "line-through")}>{c.text}</span>
            </button>
            {!c.resolved && (
              <button type="button" onClick={() => onRemove(c.id)} aria-label="删掉这条批注" className="shrink-0 text-muted-foreground transition-colors duration-fast hover:text-card-foreground">
                <Trash2 aria-hidden className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between gap-2">
        {done.length > 0 ? <button type="button" onClick={onClearResolved} className="text-10 text-muted-foreground underline-offset-2 transition-colors duration-fast hover:text-card-foreground hover:underline">清掉已交的</button> : <span />}
        <button type="button" onClick={onSend} disabled={open.length === 0 || sending} data-testid="design-comments-send"
          className="inline-flex items-center gap-1 rounded-control bg-primary px-2.5 py-1 text-11 font-medium text-primary-foreground disabled:bg-disabled disabled:text-disabled-foreground">
          <Send aria-hidden className="h-3 w-3" /> {open.length > 0 ? `把这 ${open.length} 条交给 AI 改` : "交给 AI 改"}
        </button>
      </div>
    </div>
  );
}
