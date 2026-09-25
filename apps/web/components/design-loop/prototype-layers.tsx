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

/** 对标 R7：拖拽时在 dataTransfer 里放的类型——只认自己面板拖出来的行，别的东西拖进来不响应。 */
const DRAG_TYPE = "application/x-wsx-layer";

export function PrototypeLayers({
  root, selectedId, onSelect, onMove,
}: {
  readonly root: PrototypeNode | null;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  /**
   * 对标 R7（#3933）：把 `dragged` 拖到 `target` 那一行上 ⇒ 挪到它前面。op 怎么算见
   * `dropBeforeOps`（非法的拖放在那里返回 null，这里不重复判）。上移/下移按钮仍在属性面板里，
   * 那是键盘与读屏器用户的路。
   */
  readonly onMove?: (dragged: string, target: string) => void;
}) {
  const rows = React.useMemo(() => flattenNodes(root), [root]);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  if (rows.length === 0) return null;
  return (
    <div className="flex min-h-0 flex-col border-b border-border" data-testid="design-layers">
      {/*
        * 迭代 32：「图层」是做设计的人的词。这一栏对普通人的作用是"这一页由哪些块组成"，
        * 顺带说一句共几块——原来连有多少都得自己数。中文小标题上的 uppercase 同样去掉
        * （中文没有大小写，留下的只有被拉开的字距）。
        */}
      <p className="px-3 pb-1 pt-2 text-10 font-medium text-muted-foreground" data-testid="design-layers-title">
        页面结构（{rows.length} 块）
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {rows.map(({ node, depth }) => {
          const id = node.id;
          const on = id !== undefined && id === selectedId;
          return (
            <button
              key={id ?? `${depth}-${designPrototype.prototypeNodeLabel(node)}`}
              type="button"
              // 根（depth 0）挪不走，不给拖。
              draggable={onMove !== undefined && id !== undefined && depth > 0}
              onDragStart={(e) => { if (id === undefined) return; e.dataTransfer.setData(DRAG_TYPE, id); e.dataTransfer.effectAllowed = "move"; setDragging(id); }}
              onDragEnd={() => { setDragging(null); setOver(null); }}
              onDragOver={(e) => { if (onMove === undefined || id === undefined || depth === 0 || !e.dataTransfer.types.includes(DRAG_TYPE)) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(id); }}
              onDragLeave={() => setOver((o) => (o === id ? null : o))}
              onDrop={(e) => {
                const from = e.dataTransfer.getData(DRAG_TYPE);
                setDragging(null); setOver(null);
                if (onMove !== undefined && id !== undefined && from !== "" && from !== id) { e.preventDefault(); onMove(from, id); }
              }}
              data-dragging={dragging === id ? "true" : undefined}
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
                dragging === id && "opacity-40",
                // 落点提示：一条横线画在目标行的上沿——「放在它前面」。
                over === id && dragging !== id && "shadow-[inset_0_2px_0_0_hsl(var(--primary))]",
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
