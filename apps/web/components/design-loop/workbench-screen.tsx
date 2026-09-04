"use client";
import * as React from "react";
import { Plus, Search, Pencil, Trash2, Check, Loader2, ShieldAlert, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/ui-state";
import { LinkBadge } from "./badges";
import {
  useDesignLoop, TEMPLATE_LABEL, TEMPLATE_EMOJI, type Project, type MockProjectTemplate,
} from "@/lib/design-loop-store";

const PROJECT_KIND_ORDER: MockProjectTemplate[] = ["mobile", "ui", "wireframe"];
const TEMPLATE_OPTIONS = PROJECT_KIND_ORDER.map((t) => ({ value: t, label: TEMPLATE_LABEL[t] }));
const TEMPLATE_HINT: Record<MockProjectTemplate, string> = {
  mobile: "手机为先的交互与布局",
  ui: "高保真界面与视觉稿",
  wireframe: "低保真结构与信息架构",
};

export function DesignWorkbenchHome({
  state = "default",
  onOpenProject,
}: {
  state?: UiState;
  onOpenProject?: (id: string) => void;
}) {
  const store = useDesignLoop();
  const [query, setQuery] = React.useState("");
  const [dialog, setDialog] = React.useState<null | { mode: "create"; template: MockProjectTemplate } | { mode: "edit"; project: Project }>(null);
  const [generating, setGenerating] = React.useState<string | null>(null);

  if (state === "loading") {
    return (
      <div className="grid grid-cols-3 gap-3 p-6" data-testid="loading">
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
  if (state === "dep-failed") {
    return (
      <div className="flex flex-col items-center gap-2 p-16 text-center" data-testid="dep-failed">
        <PlugZap aria-hidden className="h-8 w-8 text-muted-foreground" />
        <p className="text-14 font-medium">设计项目暂时读不到</p>
        <p className="max-w-sm text-12 text-muted-foreground">你的项目没有丢，只是这次没取到。稍后重试。</p>
        <Button size="sm" variant="outline" className="mt-1">重试</Button>
      </div>
    );
  }

  const projects = store.projects.filter((p) => query.trim() === "" || p.name.toLowerCase().includes(query.trim().toLowerCase()));

  const startCreate = (template: MockProjectTemplate) => setDialog({ mode: "create", template });

  const handleCreate = (input: { name: string; template: MockProjectTemplate; problem: string }) => {
    setDialog(null);
    setGenerating(input.name);
    window.setTimeout(() => {
      const id = store.createProject(input);
      setGenerating(null);
      onOpenProject?.(id);
    }, 1100);
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

      {/* 三张模板入口 */}
      <div className="grid grid-cols-3 gap-3 px-6 py-4">
        {PROJECT_KIND_ORDER.map((t) => (
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
      <div className="flex items-center justify-between px-6 pt-2">
        <h2 className="text-14 font-semibold">我的设计项目</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="按名称搜索" data-testid="workbench-search" className="h-8 w-48 pl-7 text-12" />
          </div>
          <Button variant="primary" size="sm" onClick={() => startCreate("mobile")} data-testid="workbench-new">
            <Plus aria-hidden className="h-3.5 w-3.5" /> 新建设计
          </Button>
        </div>
      </div>

      {store.projects.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-16 text-center" data-testid="empty">
          <p className="text-14 font-medium">还没有设计项目。</p>
          <p className="text-12 text-muted-foreground">从上面挑一个模板开始，或在收件箱把一条反馈「用 PM 设计工作台深化」。</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 p-6" data-testid="workbench-grid">
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onOpen={() => onOpenProject?.(p.id)}
              onEdit={() => setDialog({ mode: "edit", project: p })}
              onDelete={() => store.deleteProject(p.id)}
            />
          ))}
          {projects.length === 0 && (
            <p className="col-span-3 p-8 text-center text-12 text-muted-foreground">没有匹配「{query}」的项目。</p>
          )}
        </div>
      )}

      {dialog !== null && (
        <ProjectDialog
          initial={dialog.mode === "edit" ? dialog.project : { template: dialog.template }}
          editing={dialog.mode === "edit"}
          onClose={() => setDialog(null)}
          onCreate={handleCreate}
          onSave={(input) => {
            if (dialog.mode === "edit") store.updateProject(dialog.project.id, input);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function ProjectCard({ project, onOpen, onEdit, onDelete }: { project: Project; onOpen: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <div data-testid={`project-card-${project.id}`} className="flex flex-col rounded-card border border-border-subtle bg-card transition-colors duration-fast hover:border-primary">
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col items-start gap-2 p-4 text-left" data-testid={`project-open-${project.id}`}>
        <span aria-hidden className="grid h-10 w-10 place-items-center rounded-card bg-panel text-20">{project.emoji}</span>
        <span className="text-13 font-medium">{project.name}</span>
        <span className="text-11 text-muted-foreground">
          {TEMPLATE_LABEL[project.template]} · {new Date(project.updated).toLocaleDateString("zh-CN")}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {project.linkedFeedback && <LinkBadge text={`源自 ${project.linkedFeedback}`} testid={`project-link-${project.id}`} />}
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
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onEdit} aria-label="编辑项目" data-testid={`project-edit-${project.id}`}>
          <Pencil aria-hidden className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={onDelete} aria-label="删除项目" data-testid={`project-delete-${project.id}`}>
          <Trash2 aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ProjectDialog({
  initial, editing, onClose, onCreate, onSave,
}: {
  initial: { name?: string; template: MockProjectTemplate; problem?: string };
  editing: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; template: MockProjectTemplate; problem: string }) => void;
  onSave: (input: { name: string; template: MockProjectTemplate; problem: string }) => void;
}) {
  const [name, setName] = React.useState(initial.name ?? "");
  const [template, setTemplate] = React.useState<MockProjectTemplate>(initial.template);
  const [problem, setProblem] = React.useState(initial.problem ?? "");
  const canSubmit = name.trim() !== "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="project-dialog">
      <div className="absolute inset-0 bg-inverse/40" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={editing ? "编辑设计" : "新建设计"} className="relative flex w-full max-w-md flex-col gap-3 rounded-card border border-border bg-card p-5 shadow-lg">
        <h3 className="text-16 font-semibold">{editing ? "编辑设计" : "新建设计"}</h3>
        <div className="flex flex-col gap-1">
          <span className="text-11 font-medium text-muted-foreground">类别</span>
          <Select options={TEMPLATE_OPTIONS} value={template} onValueChange={(v) => setTemplate(v as MockProjectTemplate)} data-testid="project-dialog-template" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="project-name" className="text-11 font-medium text-muted-foreground">名称</label>
          <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="给这个设计起个名字" data-testid="project-dialog-name" />
          {!canSubmit && <p className="text-10 text-muted-foreground" data-testid="err-name">名称必填，起个名字才能创建。</p>}
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
            {editing ? "保存" : "创建并进入设计"}
          </Button>
        </div>
      </div>
    </div>
  );
}
