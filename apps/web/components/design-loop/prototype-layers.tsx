"use client";

/**
 * 迭代 15 —— 图层面板（当前页的节点树）。
 *
 * ## 为什么值得单独有一栏
 *
 * 模型一次画出来的树可能有二三十个节点，嵌套三层。在画板上**看得见**的只有渲染结果——
 * 一个 stack 套 stack 从外观上分不出层级，想选中"外面那个容器"只能靠反复试点。
 * 图层面板把结构摊平成可点的一列，这是 Figma / Claude Design 里最常用的那一栏。
 *
 * ## 只读结构，不读样式
 *
 * 这里**不**显示 props 细节——那是属性面板的事。每行只有：缩进（层级）、类型图标、
 * 一眼能认出的标签（`prototypeNodeLabel`，与面包屑同一个函数，不另写一份）。
 */
import * as React from "react";
import { designPrototype } from "@repo/contracts";
import { cn } from "@/lib/utils";

type PrototypeNode = designPrototype.PrototypeNode;

/** 摊平成 `{node, depth}` 一列。容器的孩子跟在它后面，缩进 +1——和树的阅读顺序一致。 */
export function flattenNodes(root: PrototypeNode | null): readonly { readonly node: PrototypeNode; readonly depth: number }[] {
  if (root === null) return [];
  const out: { node: PrototypeNode; depth: number }[] = [];
  const walk = (n: PrototypeNode, depth: number) => {
    out.push({ node: n, depth });
    if (designPrototype.isPrototypeContainer(n)) for (const c of n.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return out;
}

export function PrototypeLayers({
  root, selectedId, onSelect,
}: {
  readonly root: PrototypeNode | null;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}) {
  const rows = React.useMemo(() => flattenNodes(root), [root]);
  if (rows.length === 0) return null;
  return (
    <div className="flex min-h-0 flex-col border-b border-border" data-testid="design-layers">
      <p className="px-3 pb-1 pt-2 text-10 font-medium uppercase tracking-wide text-muted-foreground">图层</p>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {rows.map(({ node, depth }) => {
          const id = node.id;
          const on = id !== undefined && id === selectedId;
          return (
            <button
              key={id ?? `${depth}-${designPrototype.prototypeNodeLabel(node)}`}
              type="button"
              // 没有 id 的节点（服务端还没补上）点了也选不中——直接禁用，
              // 比点了没反应诚实。
              disabled={id === undefined}
              aria-pressed={on}
              onClick={() => id !== undefined && onSelect(id)}
              data-testid={id === undefined ? undefined : `design-layer-${id}`}
              data-depth={depth}
              className={cn(
                "flex w-full items-center gap-1 truncate py-0.5 pr-2 text-left text-10 transition-colors duration-fast",
                on ? "bg-primary/15 text-background-foreground" : "text-muted-foreground hover:bg-card",
                id === undefined && "opacity-50",
              )}
              style={{ paddingLeft: 12 + depth * 10 }}
            >
              <span className="truncate">{designPrototype.prototypeNodeLabel(node)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
