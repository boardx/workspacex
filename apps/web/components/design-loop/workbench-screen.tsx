"use client";
import * as React from "react";
import { Plus, Search, Pencil, Trash2, Check, Loader2, ShieldAlert, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/ui-state";
import { ApiError } from "@/lib/api-client";
import { LinkBadge } from "./badges";
import { useDialogFocus } from "./use-dialog-focus";
import {
  createProject as apiCreateProject,
  deleteProject as apiDeleteProject,
  listMyProjects,
  updateProject as apiUpdateProject,
  PROJECT_TEMPLATE_OPTIONS,
  type DesignProject,
  type ProjectTemplate,
} from "@/lib/live-design-workbench";

/**
 * UC-17.8 B4.5 —— PM 设计工作台首页，**真栈**（契约 `designWorkbench`：
 * `listMyProjects`/`createProject`/`updateProject`/`deleteProject`）。切自
 * 原型 mock store（已于 B6.1 删除）的本地 mock，同 `inbox-screen.tsx`（B3.4）的成例。
 *
 * ## 这一屏刻意的几个设计取舍
 *
 *   · **搜索 `query` 是服务端参数**（`listMyProjects({ q })`），不是本地过滤——同
 *     `inbox-screen.tsx` 的 `q`，避免"列表已加载"和"搜索结果"分裂成两份状态。
 *   · **"生成中过渡"改为等待 `createProject` 真实返回**（backlog B4.5 原文）：不再是
 *     固定 1.1s 的 `window.setTimeout` 假过渡，`generating` 态持续到 `createProject`
 *     真正 resolve/reject——失败时退回弹窗并提示错误，不静默吞掉。
 *   · **编辑/删除都是乐观本地更新之后校验，不做——用真实返回值替换本地行**：编辑成功后
 *     用服务端返回的 `project` 覆盖列表里那一条（而不是本地拼 patch），删除成功后才从
 *     列表移除；失败都保留原列表 + 提示，不假装已经生效。
 */
const TEMPLATE_LABEL: Record<ProjectTemplate, string> = {
  mobile: "移动端设计",
  ui: "UI 原型",
  wireframe: "线框图",
};
const TEMPLATE_EMOJI: Record<ProjectTemplate, string> = {
  mobile: "📱",
  ui: "🎨",
  wireframe: "🧩",
};
const TEMPLATE_HINT: Record<ProjectTemplate, string> = {
  mobile: "手机为先的交互与布局",
  ui: "高保真界面与视觉稿",
  wireframe: "低保真结构与信息架构",
};
const TEMPLATE_OPTIONS = PROJECT_TEMPLATE_OPTIONS.map((t) => ({ value: t, label: TEMPLATE_LABEL[t] }));

function describeFailure(err: unknown): string {
  if (err instanceof ApiError) return err.reasonCode ?? `http_${err.status}`;
  if (err instanceof TypeError) return "无法连接服务器，请稍后重试";
  return String(err);
}

type Load =
  | { kind: "loading" }
  | { kind: "ready"; items: DesignProject[] }
  | { kind: "failed"; reason: string };

const SEARCH_DEBOUNCE_MS = 300;

export function DesignWorkbenchHome({
  state = "default",
  onOpenProject,
}: {
  state?: UiState;
  onOpenProject?: (id: string) => void;
}) {
  const [queryInput, setQueryInput] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [dialog, setDialog] = React.useState<
    null | { mode: "create"; template: ProjectTemplate } | { mode: "edit"; project: DesignProject }
  >(null);
  const [generating, setGenerating] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = window.setTimeout(() => setQuery(queryInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [queryInput]);

  const reload = React.useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const out = await listMyProjects(query === "" ? undefined : query);
      setLoad({ kind: "ready", items: [...out.items] });
    } catch (err) {
      setLoad({ kind: "failed", reason: describeFailure(err) });
    }
  }, [query]);

  React.useEffect(() => {
    if (state !== "default") return;
    void reload();
  }, [reload, state]);

  if (state === "loading" || (state === "default" && load.kind === "loading")) {
    return (
      <div className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3" data-testid="loading">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <div key={n} className="h-32 animate-pulse rounded-card bg-muted" />
        ))}
      </div>
    );
  }
  if (state === "denied") {
    return (
      <div className="flex flex-col items-center gap-2 p-16 text-center" data-testid="denied">
        <ShieldAlert aria-hidden className="h-8 w-8 text-muted-foreground" />
        <p className="text-14 font-medium">PM 设计工作台仅 PM / 运营可见</p>
        <p className="max-w-sm text-12 text-muted-foreground">这里用来把反馈深化成设计方案再推回排期。需要权限的话联系平台管理员。</p>
      </div>
    );
  }
  if (state === "dep-failed" || (state === "default" && load.kind === "failed")) {
    const reason = state === "default" && load.kind === "failed" ? load.reason : null;
    return (
      <div className="flex flex-col items-center gap-2 p-16 text-center" data-testid="dep-failed">
        <PlugZap aria-hidden className="h-8 w-8 text-muted-foreground" />
        <p className="text-14 font-medium">设计项目暂时读不到</p>
        <p className="max-w-sm text-12 text-muted-foreground">
          你的项目没有丢，只是这次没取到{reason !== null ? `（${reason}）` : ""}。稍后重试。
        </p>
        <Button size="sm" variant="outline" className="mt-1" onClick={() => void reload()} data-testid="workbench-retry">重试</Button>
      </div>
    );
  }

  const items = load.kind === "ready" ? load.items : [];

  const startCreate = (template: ProjectTemplate) => setDialog({ mode: "create", template });

  const handleCreate = async (input: { name: string; template: ProjectTemplate; problem: string }) => {
    setDialog(null);
    setActionError(null);
    setGenerating(input.name);
    try {
      const { project } = await apiCreateProject({
        name: input.name,
        template: input.template,
        problem: input.problem === "" ? undefined : input.problem,
      });
      setLoad((prev) => (prev.kind === "ready" ? { ...prev, items: [project, ...prev.items] } : prev));
      setGenerating(null);
      onOpenProject?.(project.id);
    } catch (err) {
      setGenerating(null);
      setActionError(`没能创建设计项目（${describeFailure(err)}）`);
      window.setTimeout(() => setActionError(null), 3000);
    }
  };

  const handleSave = async (projectId: string, input: { name: string; template: ProjectTemplate; problem: string }) => {
    setBusyId(projectId);
    try {
      const { project } = await apiUpdateProject(projectId, input);
      setLoad((prev) =>
        prev.kind === "ready" ? { ...prev, items: prev.items.map((p) => (p.id === projectId ? project : p)) } : prev,
      );
      setDialog(null);
    } catch (err) {
      setActionError(`没能保存修改（${describeFailure(err)}）`);
      window.setTimeout(() => setActionError(null), 3000);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (projectId: string) => {
    setBusyId(projectId);
    try {
      await apiDeleteProject(projectId);
      setLoad((prev) => (prev.kind === "ready" ? { ...prev, items: prev.items.filter((p) => p.id !== projectId) } : prev));
    } catch (err) {
      setActionError(`没能删除这个项目（${describeFailure(err)}）`);
      window.setTimeout(() => setActionError(null), 3000);
    } finally {
      setBusyId(null);
    }
  };

  if (generating !== null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-16" data-testid="workbench-generating">
        <Loader2 aria-hidden className="h-8 w-8 animate-spin text-primary" />
        <p className="text-14 font-medium">正在把「{generating}」整理成设计稿…</p>
        <div className="grid w-full max-w-md grid-cols-3 gap-2">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-24 animate-pulse rounded-card bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto" data-testid="design-workbench">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-20 font-semibold tracking-tight">PM 设计工作台</h1>
        <p className="mt-0.5 text-12 text-muted-foreground">从模板起一个设计，或把收件箱里的反馈深化成方案，再推回排期。</p>
      </div>

      {actionError !== null && (
        <div className="mx-6 mt-3 rounded-card bg-destructive px-3 py-1.5 text-12 text-destructive-foreground" data-testid="workbench-action-error" role="alert">
          {actionError}
        </div>
      )}

      {/* 三张模板入口。B6.5（U8）：sm 以下单列堆叠——375 下三列并排每张只剩 ~100px，提示语一字一行。 */}
      <div className="grid grid-cols-1 gap-3 px-6 py-4 sm:grid-cols-3">
        {PROJECT_TEMPLATE_OPTIONS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => startCreate(t)}
            data-testid={`workbench-template-${t}`}
            className="flex flex-col items-start gap-1 rounded-card border border-border bg-card p-4 text-left transition-colors duration-fast hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span aria-hidden className="text-24">{TEMPLATE_EMOJI[t]}</span>
            <span className="text-13 font-medium">{TEMPLATE_LABEL[t]}</span>
            <span className="text-11 text-muted-foreground">{TEMPLATE_HINT[t]}</span>
          </button>
        ))}
      </div>

      {/* 我的设计项目 */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-2">
        <h2 className="text-14 font-semibold">我的设计项目</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={queryInput} onChange={(e) => setQueryInput(e.target.value)} placeholder="按名称搜索" data-testid="workbench-search" className="h-8 w-48 pl-7 text-12" />
          </div>
          <Button variant="primary" size="sm" onClick={() => startCreate("mobile")} data-testid="workbench-new">
            <Plus aria-hidden className="h-3.5 w-3.5" /> 新建设计
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-16 text-center" data-testid="empty">
          <p className="text-14 font-medium">还没有设计项目。</p>
          <p className="text-12 text-muted-foreground">从上面挑一个模板开始，或在收件箱把一条反馈「用 PM 设计工作台深化」。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3" data-testid="workbench-grid">
          {items.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              busy={busyId === p.id}
              onOpen={() => onOpenProject?.(p.id)}
              onEdit={() => setDialog({ mode: "edit", project: p })}
              onDelete={() => void handleDelete(p.id)}
            />
          ))}
        </div>
      )}

      {dialog !== null && (
        <ProjectDialog
          initial={dialog.mode === "edit" ? { name: dialog.project.name, template: dialog.project.template, problem: dialog.project.problem } : { template: dialog.template }}
          editing={dialog.mode === "edit"}
          busy={dialog.mode === "edit" ? busyId === dialog.project.id : false}
          onClose={() => setDialog(null)}
          onCreate={(input) => void handleCreate(input)}
          onSave={(input) => {
            if (dialog.mode === "edit") void handleSave(dialog.project.id, input);
          }}
        />
      )}
    </div>
  );
}

function ProjectCard({
  project, busy, onOpen, onEdit, onDelete,
}: {
  project: DesignProject;
  busy: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div data-testid={`project-card-${project.id}`} className="flex flex-col rounded-card border border-border-subtle bg-card transition-colors duration-fast hover:border-primary">
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col items-start gap-2 p-4 text-left" data-testid={`project-open-${project.id}`}>
        <span aria-hidden className="grid h-10 w-10 place-items-center rounded-card bg-panel text-20">{TEMPLATE_EMOJI[project.template]}</span>
        <span className="text-13 font-medium">{project.name}</span>
        <span className="text-11 text-muted-foreground">
          {TEMPLATE_LABEL[project.template]} · {new Date(project.updatedAt).toLocaleDateString("zh-CN")}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {project.linkedFeedbackId !== null && <LinkBadge text={`源自反馈`} testid={`project-link-${project.id}`} />}
          {project.pushed ? (
            <span className="inline-flex items-center gap-0.5 rounded-control bg-success px-1.5 py-0.5 text-10 font-medium text-success-foreground">
              <Check aria-hidden className="h-3 w-3" /> 已推送
            </span>
          ) : (
            <span className="rounded-control bg-warning px-1.5 py-0.5 text-10 font-medium text-warning-foreground">未推送</span>
          )}
        </div>
      </button>
      <div className="flex justify-end gap-1 border-t border-border-subtle px-3 py-1.5">
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onEdit} disabled={busy} aria-label="编辑项目" data-testid={`project-edit-${project.id}`}>
          <Pencil aria-hidden className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={onDelete} disabled={busy} aria-label="删除项目" data-testid={`project-delete-${project.id}`}>
          {busy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <Trash2 aria-hidden className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function ProjectDialog({
  initial, editing, busy, onClose, onCreate, onSave,
}: {
  initial: { name?: string; template: ProjectTemplate; problem?: string };
  editing: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; template: ProjectTemplate; problem: string }) => void;
  onSave: (input: { name: string; template: ProjectTemplate; problem: string }) => void;
}) {
  const [name, setName] = React.useState(initial.name ?? "");
  const [template, setTemplate] = React.useState<ProjectTemplate>(initial.template);
  const [problem, setProblem] = React.useState(initial.problem ?? "");
  const canSubmit = name.trim() !== "" && !busy;

  /** B6.5：焦点进弹窗 / Esc 关闭 / 关闭后焦点回到「新建设计」或模板卡（见 `use-dialog-focus.ts`）。 */
  const panelRef = React.useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef, onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="project-dialog">
      <div className="absolute inset-0 bg-inverse/40" onClick={onClose} aria-hidden />
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={editing ? "编辑设计" : "新建设计"} className="relative flex w-full max-w-md flex-col gap-3 rounded-card border border-border bg-card p-5 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <h3 className="text-16 font-semibold">{editing ? "编辑设计" : "新建设计"}</h3>
        <div className="flex flex-col gap-1">
          <span className="text-11 font-medium text-muted-foreground">类别</span>
          <Select options={TEMPLATE_OPTIONS} value={template} onValueChange={(v) => setTemplate(v as ProjectTemplate)} data-testid="project-dialog-template" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="project-name" className="text-11 font-medium text-muted-foreground">名称</label>
          <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="给这个设计起个名字" data-testid="project-dialog-name" />
          {name.trim() === "" && <p className="text-10 text-muted-foreground" data-testid="err-name">名称必填，起个名字才能创建。</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="project-problem" className="text-11 font-medium text-muted-foreground">背景 / 上下文（可选）</label>
          <Textarea id="project-problem" value={problem} onChange={(e) => setProblem(e.target.value)} rows={3} placeholder="想解决的问题、谁会用、现在怎么绕过去的" data-testid="project-dialog-problem" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canSubmit}
            data-testid="project-dialog-submit"
            onClick={() => (editing ? onSave : onCreate)({ name: name.trim(), template, problem: problem.trim() })}
          >
            {busy && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
            {editing ? "保存" : "创建并进入设计"}
          </Button>
        </div>
      </div>
    </div>
  );
}
