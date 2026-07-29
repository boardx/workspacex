"use client";
import * as React from "react";
import {
  Search, Upload, FileArchive, Trash2, FolderInput, Lock, LayoutList, ListTree,
  Activity, Sparkles, Download, Check, X,
} from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StateShell, StatePreviewSwitcher } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { Identity, ProjectRole } from "@/lib/identity";
import { PROJECT_ROLE_LABEL } from "@/lib/identity";
import { cn } from "@/lib/utils";
import {
  FILES, FILTERS, SOURCE_LABEL, AGENDA_SEGMENTS, UNSEGMENTED,
  FILES_SCREENS, FILES_SCREEN_LABEL, type FilesScreen, type FileItem,
} from "@/lib/mock/files";
import { FilesTree } from "./files-tree";
import { FilesList } from "./files-list";
import { FilePreview } from "./file-preview";
import { UploadModal } from "./upload-modal";
import { IngestionDrawer } from "./ingestion-drawer";
import { ReviewPanel } from "./review-panel";
import { VersionDrawer } from "./version-drawer";
import { DeleteDialog } from "./delete-dialog";
import { TrashQueue } from "./trash-queue";

type Overlay = "none" | "upload" | "ingestion" | "versions" | "delete";
const OVERLAY_SCREENS: FilesScreen[] = ["upload", "ingestion", "versions", "delete"];

/**
 * 项目文件浏览器编排 —— 用已确认的三栏骨架 AppShell（左树 / 中列表 / 右预览）。
 * `screen`/`state`/`as` 走 URL 做预览切换；屏内选择、勾选、抽屉开合走本地状态。
 * 视角切换（引导师/组长/组员/观察者）是**预览手段**，真实权限在服务端 RLS。
 */
export function FilesApp({
  identity, previewRole, uiState, screen, qs,
}: {
  identity: Identity;
  previewRole: ProjectRole | null;
  uiState: UiState;
  screen: FilesScreen;
  qs: { as?: string; org?: string };
}) {
  const mode: "browser" | "review" | "trash" =
    screen === "review" ? "review" : screen === "trash" ? "trash" : "browser";

  const [selSource, setSelSource] = React.useState<string | null>(null);
  const [selSeg, setSelSeg] = React.useState<string | null>(null);
  const [selId, setSelId] = React.useState<string | null>(FILES[0]!.id);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [overlay, setOverlay] = React.useState<Overlay>(
    OVERLAY_SCREENS.includes(screen) ? (screen as Overlay) : "none",
  );
  const [versionFile, setVersionFile] = React.useState<FileItem>(FILES[0]!);
  const [toast, setToast] = React.useState<string | null>(null);

  const files = FILES.filter(
    (f) => (selSource === null || f.sourceType === selSource) && (selSeg === null || f.segmentId === selSeg),
  );
  const selected = FILES.find((f) => f.id === selId) ?? null;
  const depFailed = uiState === "dep-failed";

  const toggleCheck = (id: string) =>
    setChecked((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const openVersions = (f: FileItem) => { setVersionFile(f); setOverlay("versions"); };

  const href = (o: Partial<{ as: string; state: string; screen: string }>) => {
    const p = new URLSearchParams();
    const as = o.as ?? qs.as; if (as) p.set("as", as);
    if (qs.org) p.set("org", qs.org);
    const st = o.state ?? uiState; if (st && st !== "default") p.set("state", st);
    const sc = o.screen ?? screen; if (sc && sc !== "browser") p.set("screen", sc);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };

  const roleView: (ProjectRole | "compliance")[] = ["facilitator", "groupLead", "member", "observer", "compliance"];

  return (
    <AppShell
      identity={identity}
      previewRole={previewRole}
      left={
        <FilesTree
          selectedSource={selSource}
          selectedSeg={selSeg}
          onSelect={(src, seg) => { setSelSource(src); setSelSeg(seg); }}
          onUpload={() => setOverlay("upload")}
        />
      }
      right={
        mode === "browser"
          ? <FilePreview file={selected} depFailed={depFailed} onOpenVersions={() => selected && openVersions(selected)} onDelete={() => setOverlay("delete")} />
          : undefined
      }
    >
      <div className="relative flex h-full min-h-0 flex-col">
        {/* 预览控制条（仅开发/预览用；生产不渲染） */}
        <PreviewControls href={href} screen={screen} uiState={uiState} qs={qs} roleView={roleView} />

        {mode === "trash" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <TrashQueue canView={previewRole === "facilitator" || qs.as === "compliance"} onToast={setToast} />
          </div>
        ) : mode === "review" ? (
          <ReviewPanel />
        ) : (
          <BrowserMode
            files={files}
            uiState={uiState}
            selId={selId}
            checked={checked}
            onRow={(f) => setSelId(f.id)}
            onToggleCheck={toggleCheck}
            onOpenVersions={openVersions}
            onUpload={() => setOverlay("upload")}
            onIngestion={() => setOverlay("ingestion")}
            onDelete={() => setOverlay("delete")}
            onClearChecked={() => setChecked(new Set())}
            onToast={setToast}
          />
        )}

        {/* 叠层 */}
        {overlay === "upload" && (
          <UploadModal
            boundSegment={selSeg && selSeg !== UNSEGMENTED.id ? AGENDA_SEGMENTS.find((s) => s.id === selSeg)?.name ?? null : null}
            onClose={() => setOverlay("none")}
            onSubmit={() => setOverlay("ingestion")}
          />
        )}
        {overlay === "ingestion" && <IngestionDrawer onClose={() => setOverlay("none")} />}
        {overlay === "versions" && <VersionDrawer file={versionFile} onClose={() => setOverlay("none")} onToast={setToast} />}
        {overlay === "delete" && <DeleteDialog onClose={() => setOverlay("none")} onToast={setToast} />}

        <FilesToast message={toast} onDismiss={() => setToast(null)} />
      </div>
    </AppShell>
  );
}

/* ── 浏览器模式（工具条 + 批量条 + StateShell 列表）──────────────────────── */

function BrowserMode({
  files, uiState, selId, checked, onRow, onToggleCheck, onOpenVersions,
  onUpload, onIngestion, onDelete, onClearChecked, onToast,
}: {
  files: FileItem[];
  uiState: UiState;
  selId: string | null;
  checked: Set<string>;
  onRow: (f: FileItem) => void;
  onToggleCheck: (id: string) => void;
  onOpenVersions: (f: FileItem) => void;
  onUpload: () => void;
  onIngestion: () => void;
  onDelete: () => void;
  onClearChecked: () => void;
  onToast: (msg: string) => void;
}) {
  const [view, setView] = React.useState<"list" | "tree">("list");
  const [activeFilters, setActiveFilters] = React.useState<Set<string>>(new Set());
  const [segMenuOpen, setSegMenuOpen] = React.useState(false);

  const toggleFilter = (key: string) =>
    setActiveFilters((s) => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶部工具条：搜索 + 六项筛选 + 视图切换 + 上传/导出 */}
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-40 flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="搜文件名与已抽取正文（FTS）" className="pl-7" data-testid="files-search" />
          </div>
          <div className="flex overflow-hidden rounded-md border border-border" data-testid="files-view-toggle">
            <Button size="sm" variant={view === "list" ? "primary" : "ghost"} onClick={() => setView("list")} data-testid="files-view-list"><LayoutList aria-hidden className="h-3.5 w-3.5" /> 列表</Button>
            <Button size="sm" variant={view === "tree" ? "primary" : "ghost"} onClick={() => setView("tree")} data-testid="files-view-tree"><ListTree aria-hidden className="h-3.5 w-3.5" /> 树</Button>
          </div>
          <Button size="sm" variant="ghost" onClick={onIngestion} data-testid="files-open-ingestion"><Activity aria-hidden className="h-3.5 w-3.5" /> 摄取进度</Button>
          <Button size="sm" variant="outline" onClick={() => onToast("已提交导出：3 份文件正在打包（导出包 exp-3402，含 manifest.json，24 小时有效）")} data-testid="files-export-zip"><FileArchive aria-hidden className="h-3.5 w-3.5" /> 导出为 zip</Button>
          <Button size="sm" variant="primary" onClick={onUpload} data-testid="files-upload"><Upload aria-hidden className="h-3.5 w-3.5" /> 上传材料</Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" data-testid="files-filters">
          <span className="text-11 text-muted-foreground">筛选（可组合、可从 URL 还原）：</span>
          {FILTERS.map((f) => {
            const active = activeFilters.has(f.key);
            return (
              <Button key={f.key} size="xs" variant={active ? "primary" : "outline"} onClick={() => toggleFilter(f.key)} data-testid="files-filter">
                <Sparkles aria-hidden className="h-2.5 w-2.5" /> {f.label}{active ? " ✓" : ""}
              </Button>
            );
          })}
          {activeFilters.size > 0 && (
            <Button size="xs" variant="ghost" onClick={() => setActiveFilters(new Set())} data-testid="files-filter-clear">清空筛选（{activeFilters.size}）</Button>
          )}
        </div>
      </div>

      {/* 批量操作条 */}
      {checked.size > 0 && (
        <div className="relative flex flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-2" data-testid="files-batch-bar">
          <span className="text-12 font-medium">已选 {checked.size} 项</span>
          <Button size="xs" variant="outline" onClick={() => onToast(`已为选中的 ${checked.size} 项逐个签发下载 URL（短时效、绑定 principal）`)} data-testid="files-batch-download"><Download aria-hidden className="h-3 w-3" /> 下载</Button>
          <Button size="xs" variant="outline" onClick={() => onToast(`已提交 ${checked.size} 项的 zip 导出（后台生成，完成后进摄取进度）`)} data-testid="files-batch-zip"><FileArchive aria-hidden className="h-3 w-3" /> 导出 zip</Button>
          <div className="relative">
            <Button size="xs" variant="outline" onClick={() => setSegMenuOpen((v) => !v)} data-testid="files-batch-segment"><FolderInput aria-hidden className="h-3 w-3" /> 归入环节</Button>
            {segMenuOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 flex w-56 flex-col rounded-md border border-border bg-card p-1 shadow-lg" data-testid="files-batch-segment-menu">
                {[...AGENDA_SEGMENTS, UNSEGMENTED].map((seg) => (
                  <button
                    key={seg.id}
                    type="button"
                    onClick={() => { setSegMenuOpen(false); onToast(`已把 ${checked.size} 项归入「${seg.name}」`); onClearChecked(); }}
                    data-testid="files-batch-segment-option"
                    className="rounded-sm px-2 py-1.5 text-left text-11 transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {seg.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button size="xs" variant="outline" onClick={() => { onToast(`已把 ${checked.size} 项标记为含机密，将进入 REVIEW_PENDING 待复核`); onClearChecked(); }} data-testid="files-batch-confidential"><Lock aria-hidden className="h-3 w-3" /> 标记机密</Button>
          <Button size="xs" variant="outline" onClick={onDelete} data-testid="files-batch-delete"><Trash2 aria-hidden className="h-3 w-3" /> 删除</Button>
          <Button size="xs" variant="ghost" className="ml-auto" onClick={onClearChecked} data-testid="files-batch-clear">取消选择</Button>
        </div>
      )}

      {/* 列表主体：七态走 StateShell */}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <StateShell
          state={uiState}
          skeletonRows={6}
          emptyHint="这个项目还没有任何文件。上传材料，或等问卷/对话/访谈自动物化进来。"
          onCreate={onUpload}
          errors={{ "files-export": "导出请求的文件数 1,240 超过单次上限 1,000，请改为分批或转后台生成。" }}
          depFailure={{ what: "对象存储（MinIO / S3）暂不可用：列表元数据来自 PG 仍可看，预览与下载已置灰并说明原因。" }}
          denial={{ layer: "project", reason: "你以观察者身份进入，只见已发布且已脱敏的文件；未发布 / 含机密 / 未脱敏的不进入你的结果集。" }}
          successMessage="已生成导出包 exp-3402（含 manifest.json，有效期 24 小时）"
        >
          {view === "tree" ? (
            <TreeViewHint />
          ) : (
            <FilesList
              files={files}
              selectedId={selId}
              checkedIds={checked}
              onRow={onRow}
              onToggleCheck={onToggleCheck}
              onOpenVersions={onOpenVersions}
            />
          )}
        </StateShell>
      </div>
    </div>
  );
}

function TreeViewHint() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-10 text-center" data-testid="files-tree-view">
      <ListTree aria-hidden className="h-6 w-6 text-muted-foreground" />
      <p className="text-12 text-muted-foreground">树视图与列表联动：用左栏来源树展开，中列表已随选择筛选。</p>
    </div>
  );
}

/* ── 乐观反馈行（导出 / 批量 / 下载等）role="status"，让人看到动作被接住 ────── */

export function FilesToast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  React.useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [message, onDismiss]);
  if (!message) return null;
  return (
    <div
      role="status"
      data-testid="files-toast"
      className="absolute bottom-4 right-4 z-40 flex max-w-sm items-start gap-2 rounded-lg border border-border bg-card p-3 shadow-lg"
    >
      <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      <p className="text-12">{message}</p>
      <Button size="icon" variant="ghost" onClick={onDismiss} aria-label="关闭提示" data-testid="files-toast-close">
        <X aria-hidden className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/* ── 预览控制条（屏切换 / 状态切换 / 视角切换）──────────────────────────── */

function PreviewControls({
  href, screen, uiState, qs, roleView,
}: {
  href: (o: Partial<{ as: string; state: string; screen: string }>) => string;
  screen: FilesScreen;
  uiState: UiState;
  qs: { as?: string; org?: string };
  roleView: (ProjectRole | "compliance")[];
}) {
  if (process.env.NODE_ENV === "production") return null;
  const currentAs = qs.as ?? "facilitator";
  return (
    <div className="flex flex-col gap-1.5 border-b border-border-subtle bg-panel-alt px-3 py-2" data-testid="files-preview-controls">
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">屏</span>
        {FILES_SCREENS.map((s) => (
          <Button key={s} asChild size="xs" variant={s === screen ? "primary" : "ghost"} data-testid="files-screen-switch">
            <a href={href({ screen: s })}>{FILES_SCREEN_LABEL[s]}</a>
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">视角</span>
        {roleView.map((r) => {
          const label = r === "compliance" ? "合规负责人" : PROJECT_ROLE_LABEL[r];
          return (
            <Button key={r} asChild size="xs" variant={currentAs === r ? "primary" : "ghost"} data-testid="files-role-switch">
              <a href={href({ as: r })}>{label}</a>
            </Button>
          );
        })}
        <Badge tone="outline" className="ml-1">预览手段 · 真实权限在服务端 RLS</Badge>
      </div>
      <StatePreviewSwitcher current={uiState} />
    </div>
  );
}
