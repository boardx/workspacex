"use client";
import * as React from "react";
import { ChevronRight, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SOURCE_ICON } from "./status";
import { buildTree, type TreeSourceNode } from "@/lib/mock/files";

/**
 * 左树 —— 来源类型（八类）→ agenda_segment。这是 `artifacts` 的**投影**，
 * 不是用户自建的文件夹（UC-22.1 R6：无自由创建/拖拽整理）。
 * 空来源节点仍显示（A5），点节点联动中列表筛选（selectedSource/selectedSeg 提到父层）。
 */
export function FilesTree({
  selectedSource, selectedSeg, onSelect, onUpload,
}: {
  selectedSource: string | null;
  selectedSeg: string | null;
  onSelect: (source: string | null, seg: string | null) => void;
  onUpload: () => void;
}) {
  const tree: TreeSourceNode[] = buildTree();
  const [open, setOpen] = React.useState<Record<string, boolean>>({ file: true, interview: true });

  return (
    <div className="flex h-full flex-col" data-testid="files-tree">
      <div className="flex items-center justify-between gap-2 p-3 pb-2">
        <h2 className="text-13 font-semibold">项目文件</h2>
        <Button size="xs" variant="ghost" onClick={onUpload} data-testid="files-tree-upload">
          <Upload aria-hidden className="h-3 w-3" /> 上传
        </Button>
      </div>

      <button
        type="button"
        onClick={() => onSelect(null, null)}
        data-testid="files-tree-all"
        className={cn(
          "mx-2 mb-1 rounded-md px-2 py-1.5 text-left text-12 transition-all duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selectedSource === null ? "bg-muted font-medium" : "hover:bg-muted",
        )}
      >
        全部来源
      </button>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {tree.map((node) => {
          const Icon = SOURCE_ICON[node.meta.key];
          const isOpen = open[node.meta.key] ?? false;
          const active = selectedSource === node.meta.key && selectedSeg === null;
          return (
            <div key={node.meta.key} data-testid="files-tree-source">
              <div
                className={cn(
                  "group flex items-center rounded-md transition-all duration-200",
                  active ? "bg-muted" : "hover:bg-muted",
                )}
              >
                <button
                  type="button"
                  aria-label={isOpen ? "折叠" : "展开"}
                  onClick={() => setOpen((s) => ({ ...s, [node.meta.key]: !isOpen }))}
                  data-testid="files-tree-toggle"
                  className="flex h-7 w-5 shrink-0 items-center justify-center rounded-md transition-all duration-200 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronRight aria-hidden className={cn("h-3 w-3 transition-transform duration-200", isOpen && "rotate-90")} />
                </button>
                <button
                  type="button"
                  onClick={() => onSelect(node.meta.key, null)}
                  title={node.meta.hint}
                  data-testid="files-tree-node"
                  className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className={cn("truncate text-12", active && "font-medium")}>{node.meta.label}</span>
                  <span className="ml-auto shrink-0 text-11 tabular-nums text-muted-foreground">{node.count}</span>
                </button>
              </div>

              {isOpen && node.children.length === 0 && (
                <p className="py-1 pl-9 text-11 text-muted-foreground" data-testid="files-tree-empty-source">
                  该来源存在，但还没有内容
                </p>
              )}
              {isOpen && node.children.map((child) => {
                const segActive = selectedSource === node.meta.key && selectedSeg === child.seg.id;
                return (
                  <button
                    key={child.seg.id}
                    type="button"
                    onClick={() => onSelect(node.meta.key, child.seg.id)}
                    data-testid="files-tree-segment"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md py-1 pl-9 pr-2 text-left text-11 transition-all duration-200",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      segActive ? "bg-secondary font-medium" : "hover:bg-muted",
                    )}
                  >
                    <span className="truncate text-muted-foreground">{child.seg.name}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{child.count}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
