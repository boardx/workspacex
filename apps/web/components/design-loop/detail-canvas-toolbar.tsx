"use client";
/**
 * 深度评测 S1（#3988）——从 `detail-screen.tsx` 拆出来的**画布工具条**：页签与页管理、画板 / 单页、
 * 编辑 / 预览 / 批注、外观（由详情页作为 `appearance` 传进来）、图层开关、撤销、重做、方案、历史、代码（深度 S6）。
 * 只搬家、不改行为：props 与详情页里的变量**同名**，搬过来的 JSX 一个字没改；状态全都留在详情页。
 */
import * as React from "react";
import { Code2, Columns3, Copy, Crosshair, History, Layers, LayoutGrid, Loader2, MessageSquarePlus, Pencil, Play, Plus, Redo2, Smartphone, Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DesignProject, PrototypeVersion } from "@/lib/live-design-workbench";
import type { useDesignComments } from "@/lib/design-comments";
import type { VariantsState } from "./variants-panel";

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
export type CanvasMode = "edit" | "preview" | "comment";

export function CanvasToolbar({
  project, preview, frame, setFrame, canvasMode, setCanvasMode, viewMode, setViewMode, setBackStack, setSelectedId,
  sideOpen, setSideOpen, renamePage, addPage, duplicatePage, removePage, pageCount, comments, undoLast, undoing, redo,
  redoStack, askVariants, sending, variants, variantScreen, historyOpen, setHistoryOpen, setPreview, appearance, codeOpen, setCodeOpen,
}: {
  readonly project: DesignProject;
  readonly preview: PrototypeVersion | null;
  readonly frame: number;
  readonly setFrame: Setter<number>;
  readonly canvasMode: CanvasMode;
  readonly setCanvasMode: Setter<CanvasMode>;
  readonly viewMode: "board" | "single";
  readonly setViewMode: Setter<"board" | "single">;
  readonly setBackStack: Setter<readonly number[]>;
  readonly setSelectedId: Setter<string | null>;
  readonly sideOpen: boolean;
  readonly setSideOpen: Setter<boolean>;
  readonly renamePage: (name: string) => void;
  readonly addPage: () => void;
  readonly duplicatePage: () => void;
  readonly removePage: () => void;
  readonly pageCount: number;
  readonly comments: ReturnType<typeof useDesignComments>;
  readonly undoLast: () => Promise<void>;
  readonly undoing: boolean;
  readonly redo: () => Promise<void>;
  readonly redoStack: readonly string[];
  readonly askVariants: () => Promise<void>;
  readonly sending: boolean;
  readonly variants: VariantsState | null;
  readonly variantScreen: number;
  readonly historyOpen: boolean;
  readonly setHistoryOpen: Setter<boolean>;
  readonly setPreview: Setter<PrototypeVersion | null>;
  /** 外观面板（明暗、强调色、品牌色、字体、圆角、密度、设备）——它的十几个回调都在详情页，整块传进来。 */
  readonly appearance: React.ReactNode;
  readonly codeOpen: boolean;
  readonly setCodeOpen: Setter<boolean>;
}) {
  return (
    <>
      {/*
        * 迭代 24：`flex-wrap` —— 放不下就换行，而不是把整个页面撑出横向滚动。
        * 宽屏一行照旧放得下，所以这一条对桌面是零改动。
        */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2">
        {/*
          * 迭代 24：页签自己横向滚，不把工具条撑宽。此前在 375 档页签被 flex 压到
          * 每字一行（「历」「史」「会」「话」竖着排），而整条工具条仍然溢出——
          * 两个毛病同一个根：一行里塞了太多东西，却既不许滚也不许换行。
          */}
        <div
          className="flex min-w-0 max-w-full items-center gap-1 overflow-x-auto"
          data-allow-x-scroll="页签多时自己横向滚动，不撑宽工具条"
          data-testid="design-detail-frames"
        >
        {(preview ?? project).frames.map((f, i) => (
          <button
            key={f}
            type="button"
            onClick={() => setFrame(i)}
            // 迭代 11：这排页签是一组互斥的"当前页"选择，读屏得知道哪一个是选中的
            // （同顶栏视图/模式切换的既有做法）。e2e 也据此断言预览模式真的换了页。
            aria-pressed={frame === i}
            data-testid={`design-detail-frame-${i}`}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-control px-2 py-1 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              frame === i ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60",
            )}
            onDoubleClick={() => {
              // 双击页签改名：就地编辑，不弹窗——改一个词不值得一个 Dialog。
              if (i !== frame || canvasMode !== "edit") return;
              const name = window.prompt("页面名字", f);
              if (name !== null) renamePage(name);
            }}
            title={i === frame && canvasMode === "edit" ? "双击改名" : undefined}
          >
            {f}
          </button>
        ))}
        {/*
          * 迭代 16：页管理。契约的 addScreen/removeScreen 从迭代 12 起就在，
          * 但从来没有 UI 够得着——模型能加删页，用户不能。
          */}
        {canvasMode === "edit" && preview === null && (
          <>
            {/*
              * 迭代 26：页签与「改名/加页/复制/删页」之间加一道分隔线。
              * 它们此前只隔着 4px，而最后一颗是**删这一页**——在手机上手指宽度
              * 远大于那个间距，点最后一个页签与删掉它只差几个像素。
              */}
            <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
            <span className="flex shrink-0 items-center gap-0.5" data-testid="design-detail-pages">
            {/*
              * 迭代 25：改名此前**只有双击页签**一条路（还用 `window.prompt`）。
              * 手机上没有双击这回事，而这排按钮在哪都点得到——改名与加/复制/删同级，
              * 本来就该并排。
              */}
            <button
              type="button"
              onClick={() => {
                const current = (preview ?? project).frames[frame] ?? "";
                const name = window.prompt("页面名字", current);
                if (name !== null) renamePage(name);
              }}
              title="给这一页改名"
              data-testid="design-detail-page-rename"
              className="rounded-control px-1 py-1 text-muted-foreground transition-colors duration-fast hover:bg-card hover:text-background-foreground"
            >
              <Pencil aria-hidden className="h-3 w-3" />
            </button>
            <button type="button" onClick={addPage} title="加一页" data-testid="design-detail-page-add"
              className="rounded-control px-1 py-1 text-muted-foreground transition-colors duration-fast hover:bg-card hover:text-background-foreground">
              <Plus aria-hidden className="h-3 w-3" />
            </button>
            <button type="button" onClick={duplicatePage} title="复制这一页" data-testid="design-detail-page-duplicate"
              className="rounded-control px-1 py-1 text-muted-foreground transition-colors duration-fast hover:bg-card hover:text-background-foreground">
              <Copy aria-hidden className="h-3 w-3" />
            </button>
            <button type="button" onClick={removePage} disabled={pageCount <= 1} title={pageCount <= 1 ? "只剩一页了，删不得" : "删掉这一页"}
              data-testid="design-detail-page-remove"
              className="rounded-control px-1 py-1 text-muted-foreground transition-colors duration-fast hover:bg-card hover:text-destructive disabled:bg-disabled disabled:text-disabled-foreground">
              <Trash2 aria-hidden className="h-3 w-3" />
            </button>
          </span>
          </>
        )}
        </div>
        <div className="ml-auto inline-flex rounded-control border border-border p-0.5" role="group" aria-label="画布视图">
          <button type="button" onClick={() => setViewMode("board")} aria-pressed={viewMode === "board"} data-testid="design-detail-view-board" title="画板：所有页并排，可平移缩放"
            className={cn("inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-10 transition-colors duration-fast", viewMode === "board" ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60")}>
            <LayoutGrid aria-hidden className="h-3 w-3" /> 画板
          </button>
          <button type="button" onClick={() => setViewMode("single")} aria-pressed={viewMode === "single"} data-testid="design-detail-view-single" title="单页：只看当前页"
            className={cn("inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-10 transition-colors duration-fast", viewMode === "single" ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60")}>
            <Smartphone aria-hidden className="h-3 w-3" /> 单页
          </button>
        </div>
        {/* 迭代 11：编辑 / 预览。预览点有跳转的节点 = 换页；进预览时清掉选中，退出再选。 */}
        <div className="inline-flex rounded-control border border-border p-0.5" role="group" aria-label="画布模式">
          <button type="button" onClick={() => { setCanvasMode("edit"); setBackStack([]); }} aria-pressed={canvasMode === "edit"} data-testid="design-detail-mode-edit" title="编辑：点节点选中它去改"
            className={cn("inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-10 transition-colors duration-fast", canvasMode === "edit" ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60")}>
            <Crosshair aria-hidden className="h-3 w-3" /> 编辑
          </button>
          <button type="button" onClick={() => { setCanvasMode("preview"); setSelectedId(null); setBackStack([]); }} aria-pressed={canvasMode === "preview"} data-testid="design-detail-mode-preview" title="预览：点有跳转的按钮，像用真的 App 一样走一遍"
            className={cn("inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-10 transition-colors duration-fast", canvasMode === "preview" ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60")}>
            <Play aria-hidden className="h-3 w-3" /> 预览
          </button>
          {/* 对标 R8：批注——先把意见钉在元素上，攒几条再一次交给 AI。 */}
          <button type="button" onClick={() => { setCanvasMode("comment"); setSelectedId(null); setBackStack([]); setSideOpen(true); }} aria-pressed={canvasMode === "comment"} data-testid="design-detail-mode-comment" title="批注：点任何一块写一句意见，攒几条一次交给 AI"
            className={cn("inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-10 transition-colors duration-fast", canvasMode === "comment" ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60")}>
            <MessageSquarePlus aria-hidden className="h-3 w-3" /> 批注{comments.comments.some((c) => !c.resolved) ? `（${comments.comments.filter((c) => !c.resolved).length}）` : ""}
          </button>
        </div>
        {/*
          * 迭代 24：明暗 / 强调色 / 设备三组收进一个「外观」面板。
          *
          * 它们的共同点是**设一次就不再动**，而此前它们在工具条上平铺了十几个控件，
          * 其中八个是没有名字的彩色圆点——第一次来做原型的人最显眼看到的就是它们，
          * 既不知道那是什么，也不知道该不该动。收起来之后，常态工具条只剩每天真用得上的
          * 那几个；点开之后每一节有中文小标题，圆点第一次有了名字。
          *
          * 顺带把 375 档那 460px 的横向滚动消掉（见 `canvas-appearance.tsx` 头注）。
          */}
        {appearance}
        {/* 迭代 24：窄屏才有的「图层」开关——md 及以上那一栏一直在，不需要这个按钮。 */}
        <button
          type="button"
          onClick={() => setSideOpen((v) => !v)}
          aria-pressed={sideOpen}
          data-testid="design-detail-side-toggle"
          title="图层与属性"
          className={cn(
            "inline-flex items-center gap-1 rounded-control px-2 py-1 text-11 transition-colors duration-fast md:hidden",
            sideOpen ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60",
          )}
        >
          <Layers aria-hidden className="h-3 w-3" /> 图层
        </button>
        {/* 迭代 16：一键撤销。此前要开历史面板、找条目、点恢复——三步。 */}
        <button
          type="button"
          onClick={() => void undoLast()}
          disabled={undoing || preview !== null}
          data-testid="design-detail-undo"
          title="回到上一版"
          className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-11 text-muted-foreground transition-colors duration-fast hover:bg-card/60 disabled:bg-disabled disabled:text-disabled-foreground"
        >
          {undoing ? <Loader2 aria-hidden className="h-3 w-3 animate-spin" /> : <Undo2 aria-hidden className="h-3 w-3" />} 撤销
        </button>
        {/* 对标 R7：重做——只有刚撤销过、且之后没有别的改动时才可用。 */}
        <button
          type="button" onClick={() => void redo()} disabled={undoing || preview !== null || redoStack.length === 0}
          data-testid="design-detail-redo" title={redoStack.length === 0 ? "没有可以重做的撤销" : "重做（⌘⇧Z）"}
          className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-11 text-muted-foreground transition-colors duration-fast hover:bg-card/60 disabled:bg-disabled disabled:text-disabled-foreground"
        >
          <Redo2 aria-hidden className="h-3 w-3" /> 重做
        </button>
        {/* 对标 R9：同一页出几个方案并排比。 */}
        <button
          type="button" onClick={() => void askVariants()}
          disabled={preview !== null || sending || variants?.kind === "loading" || (project.prototype[variantScreen] ?? null) === null}
          aria-pressed={variants !== null}
          data-testid="design-detail-variants" title="让 AI 给这一页出几个不同的方案，并排比较、挑一个"
          className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-11 text-muted-foreground transition-colors duration-fast hover:bg-card/60 disabled:bg-disabled disabled:text-disabled-foreground"
        >
          <Columns3 aria-hidden className="h-3 w-3" /> 方案
        </button>
        <button
          type="button"
          // 迭代 24：点「历史」就是要看历史——窄屏下顺手把收起的那一栏打开，
          // 否则按钮按下去 `aria-pressed` 变了而屏上什么也没发生。
          onClick={() => { setHistoryOpen((o) => !o); if (historyOpen) setPreview(null); else setSideOpen(true); }}
          aria-pressed={historyOpen}
          // 迭代 25：旁边就是「撤销」，而两者的差别对第一次来的人完全不明显。
          // 撤销那颗已经写了「回到上一版」，这颗一直没有说明。
          title="看所有版本，可以恢复到任意一版"
          data-testid="design-detail-history-toggle"
          className={cn(
            "inline-flex items-center gap-1 rounded-control px-2 py-1 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            historyOpen ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60",
          )}
        >
          <History aria-hidden className="h-3 w-3" /> 历史
        </button>
        {/* 深度 S6：看这份原型的 React 代码——同「历史」，窄屏下顺手打开右栏。 */}
        <button
          type="button"
          onClick={() => { setCodeOpen((o) => !o); if (!codeOpen) setSideOpen(true); }}
          aria-pressed={codeOpen}
          title="看这份原型导出的 React 代码，可以一键复制；改了设计，代码跟着变"
          data-testid="design-detail-code"
          className={cn(
            "inline-flex items-center gap-1 rounded-control px-2 py-1 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            codeOpen ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60",
          )}
        >
          <Code2 aria-hidden className="h-3 w-3" /> 代码
        </button>
      </div>
    </>
  );
}
