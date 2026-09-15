"use client";
import * as React from "react";
import { parseMermaidGraph, diffMermaidGraphs } from "@repo/fabric-markdown/mermaid-graph-diff";
import type { MermaidGraphDiffEntry } from "@repo/fabric-markdown/mermaid-graph-diff";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { getThreadArtifactSource, listThreadArtifacts } from "@/lib/live-chat";
import { listArtifactFileVersions, type FileVersionRow } from "@/lib/live-files";

/**
 * 「图谱版本历史」面板——一条线程里存过的**每一张图**、每张图的**版本线**，以及
 * 任意一版与**当前画布内容**之间的**结构差异**。
 *
 * 为什么需要它：`landAsArtifact` 现在可以把一次保存写成同一份产物的下一个版本，
 * 于是「这张产业图谱上一版长什么样、这一版改了什么」第一次是个有答案的问题。图谱
 * 一改就是几十个节点，光看两份 mermaid 源根本看不出改了哪个环节——所以差异**按结构
 * 呈现**（节点/边的增删改），不是文本行 diff。判定逻辑在
 * `@repo/fabric-markdown/mermaid-graph-diff` 一处，前后端共用同一份（后端经
 * `apps/api/src/domain/chat/mermaid-graph-diff.ts` 转出）。
 *
 * ## ⚠ 这个面板**比较的是哪两份东西**，以及为什么不是任意两版
 *
 * 契约里 `listVersions.out` 的每一行带 `versionNumber`，**不带 `versionId`**；而
 * 取字节的两条读路径（`previewArtifactVersion` / `issueDownloadUrl`）都要
 * `versionId`，`getThreadArtifactSource` 则恒取**最新版**（`headVersionNumber`）。
 * ⇒ 浏览器端目前**取不到任意历史版本的内容**，只能取到「某张图的最新保存版」。
 *
 * 所以这里诚实地只提供它拿得到的那条比较：**已保存的最新版 ↔ 当前画布内容**。
 * 版本线本身（第几版、什么时候、内容哈希、变更来源）是真实数据，逐行列出；历史
 * 版本的行上**不画一个点了不会有反应的「比较」按钮**——那会把一个契约缺口伪装成
 * 一个加载中的功能。缺口已在 PR 里登记：要让任意两版可比，`listVersions.out` 需要
 * 带上 `versionId`（或 `getThreadArtifactSource.in` 接受 `version`），那是一次
 * 需要签核的契约改动，不在本次范围内。
 */

/** 一张图谱产物 = 列表行 + 它最新保存版的源。 */
interface GraphArtifact {
  readonly artifactId: string;
  readonly title: string;
  readonly messageId: string;
  readonly markdown: string;
  readonly savedAt: string;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; graphs: readonly GraphArtifact[] };

/** 一份源里有没有图可比——解析得出至少一个节点才算（见文件头「按结构比较」）。 */
function isGraphSource(markdown: string): boolean {
  return parseMermaidGraph(markdown).nodes.length > 0;
}

export function ChatGraphVersionHistory({
  open, onOpenChange, threadId, projectId, bearer, currentSource,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  threadId: string;
  /** `null` = 个人线程——同 `listThreadArtifacts` 的同名参数。 */
  projectId: string | null;
  bearer?: string;
  /** 画布里此刻的 mermaid 源，差异表的「之后」一侧。 */
  currentSource: string;
}) {
  const [state, setState] = React.useState<LoadState>({ phase: "loading" });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [versions, setVersions] = React.useState<readonly FileVersionRow[] | null>(null);
  const [versionsError, setVersionsError] = React.useState<string | null>(null);

  // 打开时取一次：线程里的产物 → 逐个取最新保存版的源 → 只留真的是图的那些。
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ phase: "loading" });
    void (async () => {
      try {
        const list = await listThreadArtifacts(threadId, projectId, bearer);
        const graphs: GraphArtifact[] = [];
        for (const item of list.items) {
          try {
            const source = await getThreadArtifactSource(threadId, item.artifactId, projectId, bearer);
            if (!isGraphSource(source.markdown)) continue;
            graphs.push({
              artifactId: item.artifactId,
              title: item.title,
              messageId: item.messageId,
              markdown: source.markdown,
              savedAt: source.savedAt,
            });
          } catch {
            // 他人草稿与不存在同一个不可见出口（I-36）：跳过，不提示存在性。
          }
        }
        if (cancelled) return;
        setState({ phase: "ready", graphs });
        setSelectedId((previous) => previous ?? graphs[0]?.artifactId ?? null);
      } catch {
        if (!cancelled) setState({ phase: "error", message: "读取产物列表失败，请稍后重试" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, threadId, projectId, bearer]);

  // 选中哪张图，就取那张图的版本线。
  React.useEffect(() => {
    if (!open || selectedId === null) return;
    let cancelled = false;
    setVersions(null);
    setVersionsError(null);
    void (async () => {
      try {
        const result = await listArtifactFileVersions(selectedId, bearer);
        if (!cancelled) setVersions(result.versions);
      } catch {
        if (!cancelled) setVersionsError("读取版本列表失败，请稍后重试");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedId, bearer]);

  const graphs = state.phase === "ready" ? state.graphs : [];
  const selected = graphs.find((g) => g.artifactId === selectedId) ?? null;
  const diff = React.useMemo(
    () => (selected === null ? [] : diffMermaidGraphs(selected.markdown, currentSource)),
    [selected, currentSource],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="graph-version-history"
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>图谱版本历史</DialogTitle>
          <DialogDescription>
            这条对话里保存过的图谱、每张图的版本线，以及最新保存版与当前画布之间的结构差异。
          </DialogDescription>
        </DialogHeader>

        {state.phase === "loading" && (
          <div data-testid="loading" className="flex flex-col gap-3 animate-pulse">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-muted" />
            ))}
          </div>
        )}

        {state.phase === "error" && (
          <p role="alert" data-testid="err-graph-list" className="text-sm text-destructive">
            {state.message}
          </p>
        )}

        {state.phase === "ready" && graphs.length === 0 && (
          <div
            data-testid="empty"
            className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center"
          >
            <p className="text-sm text-muted-foreground">这条对话还没有保存过图谱</p>
            <p className="text-xs text-muted-foreground">在图上点「保存」，之后每次保存都会成为新的一版</p>
          </div>
        )}

        {state.phase === "ready" && graphs.length > 0 && (
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-foreground">选择一张图谱</h3>
              <div data-testid="graph-picker" className="flex flex-wrap gap-2">
                {graphs.map((graph) => (
                  <Button
                    key={graph.artifactId}
                    type="button"
                    size="sm"
                    variant={graph.artifactId === selectedId ? "primary" : "outline"}
                    aria-pressed={graph.artifactId === selectedId}
                    data-testid={`graph-pick-${graph.artifactId}`}
                    className="transition-colors"
                    onClick={() => setSelectedId(graph.artifactId)}
                  >
                    {graph.title}
                  </Button>
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-foreground">版本</h3>
              {versionsError !== null && (
                <p role="alert" data-testid="err-graph-versions" className="text-sm text-destructive">
                  {versionsError}
                </p>
              )}
              {versionsError === null && versions === null && (
                <div data-testid="loading-versions" className="h-14 animate-pulse rounded-lg bg-muted" />
              )}
              {versions !== null && versions.length === 0 && (
                <p data-testid="empty-versions" className="text-sm text-muted-foreground">
                  这份产物还没有版本记录
                </p>
              )}
              {versions !== null && versions.length > 0 && (
                <Table data-testid="graph-version-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>版本</TableHead>
                      <TableHead>保存时间</TableHead>
                      <TableHead>来源</TableHead>
                      <TableHead>内容哈希</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {versions.map((version) => (
                      <TableRow
                        key={version.versionNumber}
                        data-testid={`graph-version-row-${version.versionNumber}`}
                      >
                        <TableCell>
                          <Badge tone="neutral">v{version.versionNumber}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(version.createdAt).toLocaleString("zh-CN", { hour12: false })}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {version.changeSource}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {version.sha256.slice(0, 12)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="text-xs text-muted-foreground">
                历史版本的内容暂时取不回浏览器（接口只给版本号，不给版本 id），所以下面比较的是
                <span className="font-medium">最新保存版</span>与<span className="font-medium">当前画布</span>。
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-foreground">最新保存版 → 当前画布</h3>
              <GraphDiffTable diff={diff} />
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const CHANGE_LABEL: Record<"added" | "removed" | "changed", string> = {
  added: "新增",
  removed: "删除",
  changed: "修改",
};

function describeEntry(entry: MermaidGraphDiffEntry): { target: string; before: string; after: string } {
  if (entry.kind === "node") {
    if (entry.change === "changed") {
      return { target: `节点 ${entry.id}（${entry.field === "label" ? "文案" : "状态"}）`, before: entry.before, after: entry.after };
    }
    const shown = entry.status === null ? entry.label : `${entry.label} · ${entry.status}`;
    return entry.change === "added"
      ? { target: `节点 ${entry.id}`, before: "—", after: shown }
      : { target: `节点 ${entry.id}`, before: shown, after: "—" };
  }
  const link = `${entry.from} → ${entry.to}`;
  if (entry.change === "changed") return { target: `连线 ${link}`, before: entry.before, after: entry.after };
  return entry.change === "added"
    ? { target: `连线 ${link}`, before: "—", after: entry.label === "" ? "（无标签）" : entry.label }
    : { target: `连线 ${link}`, before: entry.label === "" ? "（无标签）" : entry.label, after: "—" };
}

export function GraphDiffTable({ diff }: { diff: readonly MermaidGraphDiffEntry[] }) {
  if (diff.length === 0) {
    return (
      <p data-testid="graph-diff-empty" className="text-sm text-muted-foreground">
        与保存版一致，没有结构差异
      </p>
    );
  }
  return (
    <Table data-testid="graph-diff-table">
      <TableHeader>
        <TableRow>
          <TableHead>变化</TableHead>
          <TableHead>对象</TableHead>
          <TableHead>保存版</TableHead>
          <TableHead>当前</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {diff.map((entry, index) => {
          const described = describeEntry(entry);
          return (
            <TableRow key={`${entry.kind}-${index}`} data-testid={`graph-diff-row-${index}`}>
              <TableCell>
                <Badge tone={entry.change === "removed" ? "danger" : "neutral"}>
                  {CHANGE_LABEL[entry.change]}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-foreground">{described.target}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{described.before}</TableCell>
              <TableCell className="text-sm text-foreground">{described.after}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
