"use client";
/**
 * 深度评测 S1（#3988）——从 `detail-screen.tsx` 拆出来的**画布工具条**：页签与页管理、画板 / 单页、
 * 编辑 / 预览 / 批注、外观（由详情页作为 `appearance` 传进来）、图层开关、撤销、重做、方案、历史、代码（深度 S6）、演示（深度 S7）。
 * 只搬家、不改行为：props 与详情页里的变量**同名**，搬过来的 JSX 一个字没改；状态全都留在详情页。
 */
import * as React from "react";
import { Code2, Columns3, Copy, Crosshair, Download, FileText, History, Layers, LayoutGrid, Loader2, MessageSquarePlus, MoreHorizontal, Palette, Pencil, Play, Plus, Presentation, Redo2, Smartphone, Trash2, Undo2, Upload, Users } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import type { DesignProject, PrototypeVersion } from "@/lib/live-design-workbench";
import type { useDesignComments } from "@/lib/design-comments";
import type { VariantsState } from "./variants-panel";

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
export type CanvasMode = "edit" | "preview" | "comment";

export function CanvasToolbar({
  project, preview, frame, setFrame, canvasMode, setCanvasMode, viewMode, setViewMode, setBackStack, setSelectedId,
  sideOpen, setSideOpen, renamePage, addPage, duplicatePage, removePage, pageCount, comments, undoLast, undoing, redo,
  redoStack, askVariants, sending, variants, variantScreen, historyOpen, setHistoryOpen, setPreview, appearance, codeOpen, setCodeOpen, onPresent,
  onOpenAppearance, onOpenSpec, onOpenExport, onPush, onImportThread,
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
  /** 深度 S7：进演示模式（状态在详情页：演示时整个编辑器离屏）。 */
  readonly onPresent: () => void;
  /*
   * design-delta `novice-progressive-disclosure`（#4331 U2/U3）：下面五个动作从首屏收进「更多」。
   * 状态都还在详情页，这里只负责把菜单项接到它们上面。
   */
  readonly onOpenAppearance: () => void;
  readonly onOpenSpec: () => void;
  readonly onOpenExport: () => void;
  readonly onPush: () => void;
  readonly onImportThread: () => void;
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
        {/*
          * design-delta `novice-progressive-disclosure`：页签条只在**单页**视图出现。画板视图里每一页上方
          * 本来就有「1 · 首页」这样的标题，点它就聚焦——页签条在那里是同一组信息的第二份，
          * 普通用户评测集量出它占了首屏 4 个控件。
          */}
        {viewMode === "single" && (
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
        {/* 页管理（改名 / 加页 / 复制 / 删页）：design-delta `novice-progressive-disclosure` 起在「更多」→「这一页」。 */}
        </div>
        )}
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
        {/*
          * design-delta `novice-progressive-disclosure`：原来是「编辑 / 预览 / 批注」三连。普通用户只需要知道
          * 「点一下看看点起来什么样」和「回来接着改」——一个开关就够；批注收进「更多」。
          * testid 跟着状态走：编辑态它是「预览」（design-detail-mode-preview），否则是「回到编辑」（design-detail-mode-edit）。
          */}
        {canvasMode === "edit" ? (
          <button type="button" onClick={() => { setCanvasMode("preview"); setSelectedId(null); setBackStack([]); }} aria-pressed={false} data-testid="design-detail-mode-preview" title="预览：像真的 App 一样点，点按钮会跳到对应的页"
            className="inline-flex items-center gap-1 rounded-control border border-border px-2 py-1 text-11 text-muted-foreground transition-colors duration-fast hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Play aria-hidden className="h-3 w-3" /> 预览
          </button>
        ) : (
          <button type="button" onClick={() => { setCanvasMode("edit"); setBackStack([]); }} aria-pressed data-testid="design-detail-mode-edit" title="回到编辑：点画布上的元素就能改"
            className="inline-flex items-center gap-1 rounded-control border border-border bg-card px-2 py-1 text-11 text-card-foreground transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Crosshair aria-hidden className="h-3 w-3" /> {canvasMode === "comment" ? "结束批注" : "回到编辑"}
          </button>
        )}
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
        {/* 对标 R9：同一页出几个方案并排比。 */}
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
        {/*
          * 深度 S7：演示——从当前这一页开始整屏放。放在工具条而不是页头：页头在 375 宽下已经满了
          * （响应式车道实测溢出），工具条会换行。
          */}
        {/*
          * design-delta `novice-progressive-disclosure`（#4331 U2/U3）——**「更多」**。
          *
          * 普通用户评测集量出详情页首屏 57 个可操作控件（预算 15），外加「代码 / 批注 / 方案 / 推送到收件箱」
          * 这类第一次来的人看不懂的词。这些动作都还在、一个没删，只是不再全部摊在首屏：
          * 首屏留「说一句话改 / 预览 / 撤销 / 历史 / 画板·单页 / 分享」，其余收进这里，按「画布 / 这一页 / 项目」分组。
          * 菜单项沿用原来按钮的 testid——测试与读屏找的仍是同一个东西，只是要先打开「更多」。
          */}
        <Menu>
          <MenuTrigger asChild>
            <button type="button" data-testid="design-detail-more" title="更多：外观、演示、导出、交给开发，以及这一页的改名、复制、删除"
              className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-11 text-muted-foreground transition-colors duration-fast hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <MoreHorizontal aria-hidden className="h-3.5 w-3.5" /> 更多
            </button>
          </MenuTrigger>
          <MenuContent align="end" className="w-60" data-testid="design-detail-more-menu">
            <MenuLabel>画布</MenuLabel>
            <MenuItem data-testid="design-detail-mode-comment" onSelect={() => { setCanvasMode("comment"); setSelectedId(null); setBackStack([]); setSideOpen(true); }}>
              <MessageSquarePlus aria-hidden className="h-3.5 w-3.5" /> 批注：在画面上钉一句话{comments.comments.some((c) => !c.resolved) ? `（${comments.comments.filter((c) => !c.resolved).length}）` : ""}
            </MenuItem>
            <MenuItem data-testid="design-detail-appearance" onSelect={onOpenAppearance}>
              <Palette aria-hidden className="h-3.5 w-3.5" /> 外观：明暗、颜色、字体、设备
            </MenuItem>
            <MenuItem data-testid="design-detail-variants" aria-pressed={variants !== null}
              disabled={preview !== null || sending || variants?.kind === "loading" || (project.prototype[variantScreen] ?? null) === null}
              onSelect={() => void askVariants()}>
              <Columns3 aria-hidden className="h-3.5 w-3.5" /> 这一页多出几版对比
            </MenuItem>
            <MenuItem data-testid="design-detail-present" disabled={project.prototype.every((r) => r === null)} onSelect={onPresent}>
              <Presentation aria-hidden className="h-3.5 w-3.5" /> 演示：整屏一页页放给别人看
            </MenuItem>
            <MenuItem data-testid="design-detail-redo" disabled={undoing || preview !== null || redoStack.length === 0} onSelect={() => void redo()}>
              <Redo2 aria-hidden className="h-3.5 w-3.5" /> 重做（⌘⇧Z）
            </MenuItem>
            <MenuItem data-testid="design-detail-more-structure" onSelect={() => setSideOpen((v) => !v)}>
              <Layers aria-hidden className="h-3.5 w-3.5" /> {sideOpen ? "收起页面结构" : "显示页面结构"}
            </MenuItem>
            {canvasMode === "edit" && preview === null && (
              <>
                <MenuSeparator />
                <MenuLabel>这一页（{(preview ?? project).frames[frame] ?? ""}）</MenuLabel>
                <MenuItem data-testid="design-detail-page-rename" onSelect={() => {
                  const current = (preview ?? project).frames[frame] ?? "";
                  const name = window.prompt("页面名字", current);
                  if (name !== null) renamePage(name);
                }}>
                  <Pencil aria-hidden className="h-3.5 w-3.5" /> 给这一页改名
                </MenuItem>
                <MenuItem data-testid="design-detail-page-add" onSelect={addPage}>
                  <Plus aria-hidden className="h-3.5 w-3.5" /> 加一页
                </MenuItem>
                <MenuItem data-testid="design-detail-page-duplicate" onSelect={duplicatePage}>
                  <Copy aria-hidden className="h-3.5 w-3.5" /> 复制这一页
                </MenuItem>
                <MenuItem data-testid="design-detail-page-remove" disabled={pageCount <= 1} title={pageCount <= 1 ? "只剩一页了，删不得" : undefined} onSelect={removePage}>
                  <Trash2 aria-hidden className="h-3.5 w-3.5" /> 删掉这一页
                </MenuItem>
              </>
            )}
            <MenuSeparator />
            <MenuLabel>项目</MenuLabel>
            <MenuItem data-testid="design-detail-tab-spec" onSelect={onOpenSpec}>
              <FileText aria-hidden className="h-3.5 w-3.5" /> 需求说明与验收标准
            </MenuItem>
            <MenuItem data-testid="design-detail-export" onSelect={onOpenExport}>
              <Download aria-hidden className="h-3.5 w-3.5" /> 导出：文档、截图、可点击原型……
            </MenuItem>
            <MenuItem data-testid="design-detail-push" onSelect={onPush}>
              <Upload aria-hidden className="h-3.5 w-3.5" /> {project.pushed ? "已交给开发排期" : "交给开发排期"}
            </MenuItem>
            <MenuItem data-testid="design-detail-import-thread" onSelect={onImportThread}>
              <Users aria-hidden className="h-3.5 w-3.5" /> 从一段已有对话导入背景
            </MenuItem>
            <MenuItem data-testid="design-detail-code" aria-pressed={codeOpen} onSelect={() => { setCodeOpen((o) => !o); if (!codeOpen) setSideOpen(true); }}>
              <Code2 aria-hidden className="h-3.5 w-3.5" /> {codeOpen ? "收起给开发看的代码" : "给开发看的代码"}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </>
  );
}
