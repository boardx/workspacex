"use client";
/**
 * F354 -- the REAL-data half of the project file browser.
 *
 * Rendered by `FilesApp` instead of the mock-driven `BrowserMode` whenever a session token is
 * present (the same "logged in via `/project/live`, token in `localStorage`" convention F122
 * established -- this page has no login form of its own, on purpose, to avoid a second login UI
 * next to the one real entry point).
 *
 * ## Why this is a SEPARATE component rather than `FilesList`/`FilesTree` fed real data
 *
 * `files.FileNode` (what `listProjectArtifacts` / `getArtifactTree` actually return) has 10
 * fields. `lib/mock/files.ts`'s `FileItem` (what `FilesList`/`FilesTree`/`FilePreview` require)
 * has ~20, including `uploader` (human/agent + name), `versionCount`, `visibility`, `sha256`,
 * `preview` kind, `derived[]`, `versions[]`, `sourceRef` -- none of which the signed contract
 * puts on `FileNode`. Feeding real data through props typed for the mock shape would mean
 * inventing values for every one of those (a fake uploader name, a fake version count) to
 * satisfy the type, which is exactly the "看起来算过的数" failure mode this repo's own
 * `project/live/page.tsx` header names and refuses to do. So: a second, narrower view that only
 * renders what the server actually said, and every column the mock table has that this one
 * does not is a gap reported in the PR rather than a fabricated cell.
 *
 * ## What is NOT wired here (reported, not silently dropped)
 *
 *   - Preview / single-file download: `previewArtifactVersion` / `issueDownloadUrl` need a
 *     `versionId`, and neither `listProjectArtifacts` nor `getArtifactTree` returns one (see
 *     `lib/live-files.ts` header). Shown as an explicit notice, not a blank pane.
 *   - trash-queue / review-panel: no controller backs `resolveReviewPending` or any
 *     deletion/legal-hold route yet (F46/F39 territory per the issue) -- left on mock.
 *
 * ## Export selection (F364)
 *
 * Each row has a checkbox (`live-files-row-checkbox`) feeding a `selectedIds` set. Zero selected
 * is treated the same as this view's original all-rows export: `createExportJob` is called with
 * `artifactIds: null`, matching `application/files/export-artifacts.ts`'s own documented ruling
 * ("both null -> whole visible tree") and this button's pre-F364 behaviour when there was no
 * selection state at all. A non-empty selection scopes the export to exactly those artifact ids;
 * the button label and toast both say which mode ran, so "I picked 2 files but got the whole
 * project" is never silently possible.
 */
import * as React from "react";
import { FileWarning, FolderTree, RefreshCw, FileArchive, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api-client";
import {
  listProjectArtifacts, getArtifactTree, createExportJob, getExportJob, renameArtifact,
  type FileNode, type TreeNode,
} from "@/lib/live-files";
import { IngestBadge, ConfidentialBadge } from "./status";
import { formatBytes, type IngestState } from "@/lib/mock/files";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.reasonCode ?? `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return "未知错误";
}

export function LiveFilesBrowser({ projectId, onToast }: { projectId: string; onToast: (msg: string) => void }) {
  const [nodes, setNodes] = React.useState<FileNode[] | null>(null);
  const [tree, setTree] = React.useState<TreeNode[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [selected, setSelected] = React.useState<FileNode | null>(null);
  const [renaming, setRenaming] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState("");
  const [exportBusy, setExportBusy] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());

  function toggleSelected(artifactId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(artifactId)) next.delete(artifactId);
      else next.add(artifactId);
      return next;
    });
  }

  const load = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [list, treeOut] = await Promise.all([
        listProjectArtifacts(projectId, { view: "list" }),
        getArtifactTree(projectId),
      ]);
      setNodes(list.nodes);
      setTree(treeOut.tree);
    } catch (e) {
      setError(describeError(e));
      setNodes(null);
      setTree(null);
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function handleRename(artifactId: string) {
    if (renameValue.trim() === "") return;
    try {
      await renameArtifact(artifactId, renameValue.trim(), "文件浏览器内联重命名");
      onToast(`已重命名，旧路径仍可通过别名解析访问`);
      setRenaming(false);
      await load();
    } catch (e) {
      onToast(`重命名失败：${describeError(e)}`);
    }
  }

  async function handleExport() {
    setExportBusy(true);
    const artifactIds = selectedIds.size > 0 ? [...selectedIds] : null;
    try {
      const job = await createExportJob(projectId, artifactIds);
      const scope = artifactIds === null ? "整个项目" : `所选 ${artifactIds.length} 项`;
      onToast(`已提交导出（${scope}，jobId=${job.jobId}，状态：${job.status}）`);
      // 轮询直至完成/失败，最多 10 次 —— 这里只是把状态显示出来，不做无限重试。
      for (let i = 0; i < 10 && job.status !== "done" && job.status !== "failed"; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const polled = await getExportJob(job.jobId);
        if (polled.status === "done" || polled.status === "failed") {
          onToast(
            polled.status === "done"
              ? `导出完成：${polled.downloadUrl ?? "（无下载链接）"}`
              : `导出失败：${polled.failureReason ?? "未知原因"}`,
          );
          break;
        }
      }
    } catch (e) {
      onToast(`导出请求失败：${describeError(e)}`);
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1" data-testid="live-files-browser">
      <div className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="flex items-center justify-between gap-2 p-3 pb-2">
          <h2 className="flex items-center gap-1.5 text-13 font-semibold">
            <FolderTree aria-hidden className="h-3.5 w-3.5" /> 目录树（真实数据）
          </h2>
          <Button size="xs" variant="ghost" onClick={() => void load()} disabled={busy} data-testid="live-files-refresh">
            <RefreshCw aria-hidden className={busy ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {tree === null ? (
            <p className="px-2 text-11 text-muted-foreground">{busy ? "加载中…" : "—"}</p>
          ) : tree.length === 0 ? (
            <p className="px-2 text-11 text-muted-foreground" data-testid="live-files-tree-empty">这个项目还没有任何来源节点。</p>
          ) : (
            <ul className="flex flex-col gap-0.5" data-testid="live-files-tree">
              {tree.map((n) => (
                <li
                  key={`${n.level}-${n.key}`}
                  data-testid="live-files-tree-node"
                  className={n.level === 1 ? "px-2 py-1 text-12" : "px-2 py-0.5 pl-5 text-11 text-muted-foreground"}
                >
                  <span>{n.label}</span>
                  <span className="ml-2 tabular-nums text-muted-foreground">{n.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <p className="text-12 text-muted-foreground">
            {nodes === null ? "" : `${nodes.length} 份文件（真实 Postgres 数据，项目 ${projectId}）`}
          </p>
          <Button size="sm" variant="outline" onClick={() => void handleExport()} disabled={exportBusy} data-testid="live-files-export">
            <FileArchive aria-hidden className="h-3.5 w-3.5" />
            {exportBusy
              ? "导出中…"
              : selectedIds.size > 0
                ? `导出所选 ${selectedIds.size} 项为 zip`
                : "导出整个项目为 zip"}
          </Button>
        </div>

        {error !== null ? (
          <p className="p-3 text-12 text-destructive" data-testid="live-files-error">加载失败：{error}</p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto">
          {nodes === null ? (
            <p className="p-4 text-12 text-muted-foreground">{busy ? "加载中…" : "—"}</p>
          ) : nodes.length === 0 ? (
            <p className="p-4 text-12 text-muted-foreground" data-testid="live-files-list-empty">
              这个项目还没有任何文件。
            </p>
          ) : (
            <Table className="w-full min-w-[42rem] border-collapse text-12" data-testid="live-files-list">
              <TableHeader>
                <TableRow className="border-b border-border text-left text-11 text-muted-foreground">
                  <TableHead className="px-2 py-2 font-medium">
                    <input
                      type="checkbox"
                      aria-label="全选"
                      data-testid="live-files-select-all"
                      checked={nodes.length > 0 && selectedIds.size === nodes.length}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < nodes.length;
                      }}
                      onChange={(e) =>
                        setSelectedIds(e.target.checked ? new Set(nodes.map((n) => n.artifactId)) : new Set())
                      }
                    />
                  </TableHead>
                  <TableHead className="px-2 py-2 font-medium">名称</TableHead>
                  <TableHead className="px-2 py-2 font-medium">来源类型</TableHead>
                  <TableHead className="px-2 py-2 font-medium">大小</TableHead>
                  <TableHead className="px-2 py-2 font-medium">所属环节</TableHead>
                  <TableHead className="px-2 py-2 font-medium">摄取状态</TableHead>
                  <TableHead className="px-2 py-2 font-medium">更新时间</TableHead>
                  <TableHead className="px-2 py-2 font-medium" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((n) => (
                  <TableRow
                    key={n.artifactId}
                    data-testid="live-files-row"
                    onClick={() => setSelected(n)}
                    className={
                      "cursor-pointer border-b border-border-subtle transition-colors duration-200 " +
                      (selected?.artifactId === n.artifactId ? "bg-muted" : "hover:bg-panel")
                    }
                  >
                    <TableCell className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`选中 ${n.name} 用于导出`}
                        data-testid="live-files-row-checkbox"
                        checked={selectedIds.has(n.artifactId)}
                        onChange={() => toggleSelected(n.artifactId)}
                      />
                    </TableCell>
                    <TableCell className="max-w-[16rem] px-2 py-1.5">
                      <span className="truncate font-medium" title={n.name}>{n.name}</span>
                      {n.confidential && <span className="ml-1.5 inline-block align-middle"><ConfidentialBadge /></span>}
                    </TableCell>
                    <TableCell className="px-2 py-1.5 text-muted-foreground">{n.sourceType}</TableCell>
                    <TableCell className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">{formatBytes(n.sizeBytes)}</TableCell>
                    <TableCell className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{n.agendaSegmentId ?? "—"}</TableCell>
                    <TableCell className="px-2 py-1.5"><IngestBadge state={n.ingestionStatus as IngestState} /></TableCell>
                    <TableCell className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{n.updatedAt}</TableCell>
                    <TableCell className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => { setSelected(n); setRenaming(true); setRenameValue(n.name); }}
                        data-testid="live-files-rename-open"
                      >
                        <Pencil aria-hidden className="h-3 w-3" /> 重命名
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <div className="flex w-72 shrink-0 flex-col border-l border-border p-3">
        {selected === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center" data-testid="live-files-preview-none">
            <FileWarning aria-hidden className="h-6 w-6 text-muted-foreground" />
            <p className="text-12 text-muted-foreground">选一份文件查看详情</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2" data-testid="live-files-preview">
            <p className="text-13 font-semibold" title={selected.name}>{selected.name}</p>
            <div className="flex flex-wrap gap-1">
              <Badge tone="outline">{selected.sourceType}</Badge>
              {selected.confidential && <ConfidentialBadge />}
            </div>
            <p className="text-11 text-muted-foreground">
              {formatBytes(selected.sizeBytes)} · 更新于 {selected.updatedAt}
            </p>
            <p className="text-11 text-muted-foreground">
              可下载原件：{selected.originalDownloadable ? "是" : "否"} · 可检索：{selected.retrievable ? "是" : "否"}
            </p>

            {renaming ? (
              <div className="flex flex-col gap-1.5 rounded-md border border-border p-2">
                <input
                  className="h-8 rounded-md border border-input bg-card px-2 text-12"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  data-testid="live-files-rename-input"
                />
                <div className="flex gap-1.5">
                  <Button size="xs" variant="primary" onClick={() => void handleRename(selected.artifactId)} data-testid="live-files-rename-submit">
                    确认
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setRenaming(false)}>取消</Button>
                </div>
              </div>
            ) : null}

            <div className="mt-2 rounded-md border border-dashed border-border p-2 text-11 text-muted-foreground" data-testid="live-files-preview-gap">
              预览与单文件下载暂未接入：`previewArtifactVersion` / `issueDownloadUrl` 需要
              `versionId`，而 `listProjectArtifacts` / `getArtifactTree` 只返回
              `artifactId`——契约缺一个从 artifact 取当前 versionId 的读接口（见
              `apps/web/lib/live-files.ts` 文件头）。已如实报告，未伪造。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
