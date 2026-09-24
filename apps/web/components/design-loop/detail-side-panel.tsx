"use client";
/**
 * 深度评测 S1（#3988）——从 `detail-screen.tsx` 拆出来的**右栏**：图层面板、批注（写一句 + 列表）、属性面板、
 * 版本历史；深度 S6 起还有「代码」面板。只搬家、不改行为：props 与详情页里的变量同名，搬过来的 JSX 一个字没改；状态都留在详情页。
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { dropBeforeOps } from "@/lib/prototype-node-actions";
import { composeCommentsMessage, type useDesignComments } from "@/lib/design-comments";
import {
  prototypeNodeLabel,
  type findPrototypeNodePath,
  type DesignProject,
  type PrototypeLink,
  type PrototypePatchOp,
  type PrototypeVersion,
} from "@/lib/live-design-workbench";
import { PrototypeHistoryPanel } from "./prototype-history";
import { PrototypeLayers } from "./prototype-layers";
import { PrototypeInspector } from "./prototype-inspector";
import { CommentComposer, CommentList } from "./comments-panel";
import { PrototypeCodePanel } from "./prototype-code-panel";
import type { CanvasMode } from "./detail-canvas-toolbar";

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

export function DetailSidePanel({
  historyOpen, codeOpen, preview, canvasMode, focus, sideOpen, project, frame, setFrame, selectedId, setSelectedId,
  runNodeOps, comments, sending, send, setLoad, frameLinks, setPageLinks, setPreview,
}: {
  readonly historyOpen: boolean;
  readonly codeOpen: boolean;
  readonly preview: PrototypeVersion | null;
  readonly canvasMode: CanvasMode;
  readonly focus: ReturnType<typeof findPrototypeNodePath>;
  readonly sideOpen: boolean;
  readonly project: DesignProject;
  readonly frame: number;
  readonly setFrame: Setter<number>;
  readonly selectedId: string | null;
  readonly setSelectedId: Setter<string | null>;
  readonly runNodeOps: (ops: readonly PrototypePatchOp[] | null, summary: string) => Promise<boolean>;
  readonly comments: ReturnType<typeof useDesignComments>;
  readonly sending: boolean;
  readonly send: (text?: string, maxScreens?: number) => Promise<boolean>;
  readonly setLoad: (l: { kind: "ready"; project: DesignProject }) => void;
  readonly frameLinks: readonly (readonly PrototypeLink[])[];
  readonly setPageLinks: (pageIndex: number, links: readonly PrototypeLink[]) => Promise<void>;
  readonly setPreview: Setter<PrototypeVersion | null>;
}) {
  return (
    <>
      {/* 迭代 5：右栏——选中节点时顶部是属性面板（预览态不显示），下方按需是版本历史 */}
      {/* md 以下：右栏盖在画布上（absolute），不把 375px 撑出横向溢出（B6.5 同一纪律）；md 及以上并排 */}
      {/* 迭代 15：编辑态下侧栏常驻（图层面板），不再只有选中时才出现 */}
      {(historyOpen || codeOpen || (preview === null && canvasMode !== "preview") || (focus !== null && preview === null)) && (
        /*
         * 迭代 24：窄屏下这块**默认收起**。
         *
         * 它此前是 `absolute inset-y-0 right-0 w-64 max-w-[85%]`，而显示条件基本等于
         * 「编辑态」——也就是默认状态。结果：在手机上打开一个设计，画布被这块盖掉 85%，
         * 而且**原型里的任何东西都点不到**（点击落在面板上）。里面装的又恰好是
         * 「纵向布局 / 横向布局 / 卡片」这类只有做过设计的人才懂的词。
         *
         * 所以窄屏改成"要看才打开"，由工具条上的「图层」按钮开关；md 及以上**一个像素都不变**
         * （那里它是并排的一栏，不挡任何东西）。
         */
        <div
          className={cn(
            "absolute inset-y-0 right-0 z-10 w-64 max-w-[85%] shrink-0 flex-col border-l border-border bg-card/95 md:static md:flex md:max-w-none md:bg-card/40",
            sideOpen ? "flex" : "hidden",
          )}
          data-testid="design-detail-side"
        >
          {/* 深度 S6：代码面板放最上面——打开它就是要看它；它随 `project` 重算。 */}
          {codeOpen && <PrototypeCodePanel project={project} />}
          {/*
            * 迭代 15：图层面板。一个 stack 套 stack 在画板上分不出层级，
            * 想选中"外面那个容器"只能反复试点——摊平成可点的一列是最直接的解法。
            * 预览态不显示：那时候没有"选中"这回事。
            */}
          {preview === null && canvasMode === "edit" && (
            <PrototypeLayers
              root={project.prototype[Math.min(frame, project.frames.length - 1)] ?? null}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMove={(dragged, target) => void runNodeOps(dropBeforeOps(project.prototype, dragged, target), "移动这个节点")}
            />
          )}
          {/* 对标 R8：批注模式下右栏是「写一句」+ 批注列表，不是属性面板。 */}
          {preview === null && canvasMode === "comment" && (
            <>
              {focus !== null && (
                <CommentComposer
                  label={prototypeNodeLabel(focus.path[focus.path.length - 1]!)}
                  onSave={(t) => { comments.add({ nodeId: selectedId!, frameIndex: focus.frameIndex, label: prototypeNodeLabel(focus.path[focus.path.length - 1]!), text: t }); setSelectedId(null); }}
                  onCancel={() => setSelectedId(null)}
                />
              )}
              <CommentList
                comments={comments.comments} frame={frame} sending={sending} error={comments.error}
                onRemove={comments.remove} onClearResolved={comments.clearResolved}
                onReply={comments.reply} onSetResolved={(id, resolved) => void comments.setResolved(id, resolved)}
                onFocus={(c) => { setFrame(c.frameIndex); }}
                onSend={() => {
                  const open = comments.comments.filter((c) => !c.resolved);
                  void send(composeCommentsMessage(open, project.frames)).then((ok) => { if (ok) comments.resolve(open.map((c) => c.id)); });
                }}
              />
            </>
          )}
          {focus !== null && preview === null && canvasMode === "edit" && (
            <PrototypeInspector
              projectId={project.id}
              prototype={project.prototype}
              onNodeOps={async (ops, summary) => { await runNodeOps(ops, summary); }}
              node={focus.path[focus.path.length - 1]!}
              path={focus.path}
              onSaved={(p) => setLoad({ kind: "ready", project: p })}
              onDeleted={(p) => { setLoad({ kind: "ready", project: p }); setSelectedId(null); }}
              frames={project.frames}
              frameIndex={focus.frameIndex}
              links={frameLinks[focus.frameIndex] ?? []}
              onSetLinks={(links) => setPageLinks(focus.frameIndex, links)}
            />
          )}
          {historyOpen && (
            <PrototypeHistoryPanel
              projectId={project.id}
              revision={project.updatedAt}
              isOwner
              previewId={preview?.id ?? null}
              onPreview={setPreview}
              onRestored={(p) => { setLoad({ kind: "ready", project: p }); setFrame(0); setSelectedId(null); }}
            />
          )}
        </div>
      )}
    </>
  );
}
