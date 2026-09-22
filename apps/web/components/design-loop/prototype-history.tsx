"use client";
/**
 * 迭代 3 —— 原型版本历史面板（画布右侧一栏）。
 *
 * 列表来自 `listPrototypeVersions`（不带树）；点一条 ⇒ 拉单条（带树）交给父组件进「预览」态；
 * 「恢复」仅 owner ⇒ `restorePrototypeVersion`，父组件用返回的 project 整体替换并退出预览。
 * 历史只追加：恢复之后列表顶上会多出一条 `source: restore`，不会少掉任何一条。
 */
import * as React from "react";
import { History, Loader2, RotateCcw, Bot, User, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { describeFailure } from "@/lib/design-failure";
import { humanTime } from "@/lib/human-time";
import {
  getPrototypeVersion,
  listPrototypeVersions,
  restorePrototypeVersion,
  type DesignProject,
  type PrototypeVersion,
  type PrototypeVersionSummary,
} from "@/lib/live-design-workbench";

/** 迭代 28：「模型 / 手改 / 恢复」是内部说法——按**谁做的**说。 */
const SOURCE_LABEL: Record<PrototypeVersionSummary["source"], { text: string; Icon: typeof Bot }> = {
  model: { text: "AI 画的", Icon: Bot },
  user: { text: "你改的", Icon: User },
  restore: { text: "退回来的", Icon: Undo2 },
};

/**
 * 迭代 28：原来是 `err.reasonCode ?? \`http_${err.status}\``——版本历史里把内部码原样端出去。
 * 与对话、属性面板同走一份 `describeFailure`，同一类失败在同一屏上说同一句话。
 */
const reason = (err: unknown): string => describeFailure(err);

export function PrototypeHistoryPanel({
  projectId, revision, isOwner, previewId, onPreview, onRestored,
}: {
  projectId: string;
  /** 项目的 `updatedAt`——它一变就重拉列表（对话写回 / 手改 / 恢复都会改它），面板开着也不会过期。 */
  revision: string;
  isOwner: boolean;
  /** 正在预览的版本 id（父组件持有），用于高亮。 */
  previewId: string | null;
  onPreview: (version: PrototypeVersion | null) => void;
  onRestored: (project: DesignProject) => void;
}) {
  const [items, setItems] = React.useState<readonly PrototypeVersionSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const { items: list } = await listPrototypeVersions(projectId);
      setItems(list);
      setError(null);
    } catch (err) {
      setError(reason(err));
    }
  }, [projectId]);

  React.useEffect(() => { void load(); }, [load, revision]);

  const preview = async (v: PrototypeVersionSummary) => {
    if (previewId === v.id) { onPreview(null); return; }
    setBusy(v.id);
    try {
      const { version } = await getPrototypeVersion(projectId, v.id);
      onPreview(version);
    } catch (err) {
      setError(reason(err));
    } finally {
      setBusy(null);
    }
  };

  const restore = async (v: PrototypeVersionSummary) => {
    setBusy(v.id);
    try {
      const out = await restorePrototypeVersion(projectId, v.id);
      onPreview(null);
      onRestored(out.project);
      await load();
    } catch (err) {
      setError(reason(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="flex min-h-0 flex-1 flex-col" data-testid="design-history">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-12 font-medium">
        <History aria-hidden className="h-3.5 w-3.5" /> 版本历史
        {items !== null && <span className="ml-auto text-10 text-muted-foreground">{items.length} 版</span>}
      </div>
      {error !== null && <p className="px-3 py-2 text-11 text-destructive" role="alert" data-testid="design-history-error">{error}</p>}
      {items === null && error === null && (
        <div className="grid flex-1 place-items-center"><Loader2 aria-hidden className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      )}
      {items !== null && items.length === 0 && (
        <p className="px-3 py-3 text-11 text-muted-foreground" data-testid="design-history-empty">还没有版本。AI 第一次画出原型后，这里会记下每一版——改坏了随时能退回来。</p>
      )}
      {items !== null && items.length > 0 && (
        <ol className="min-h-0 flex-1 overflow-y-auto">
          {items.map((v) => {
            const { text, Icon } = SOURCE_LABEL[v.source];
            const active = previewId === v.id;
            return (
              <li key={v.id} className={cn("border-b border-border/60", active && "bg-primary/10")} data-testid={`design-history-item-${v.seq}`}>
                <button
                  type="button"
                  onClick={() => void preview(v)}
                  className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors duration-fast hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`design-history-preview-${v.seq}`}
                >
                  <span className="flex items-center gap-1.5 text-11">
                    <span className="font-medium">第 {v.seq} 版</span>
                    <span className="inline-flex items-center gap-0.5 rounded-control bg-panel px-1 text-10 text-muted-foreground"><Icon aria-hidden className="h-2.5 w-2.5" />{text}</span>
                    <span className="ml-auto text-10 text-muted-foreground">{humanTime(v.createdAt)}</span>
                    {busy === v.id && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}
                  </span>
                  <span className="line-clamp-2 text-10 text-muted-foreground">{v.summary || v.frames.join(" · ")}</span>
                </button>
                {active && isOwner && (
                  <div className="flex justify-end px-3 pb-2">
                    {/* 迭代 28：历史只追加，恢复不会丢掉现在这一版——按钮旁边把这件事说出来，
                        否则"恢复"看上去像一次不可逆的覆盖，普通人不敢按。 */}
                    <div className="flex flex-col items-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => void restore(v)} disabled={busy !== null} data-testid={`design-history-restore-${v.seq}`}>
                        <RotateCcw aria-hidden className="h-3 w-3" /> 退回到这一版
                      </Button>
                      <span className="text-10 text-muted-foreground" data-testid={`design-history-restore-safe-${v.seq}`}>现在这一版也会留在历史里，随时能再回来。</span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
