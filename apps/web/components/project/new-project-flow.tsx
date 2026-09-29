"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Presentation } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import { useSession } from "@/components/session/session-provider";
import { createProject } from "@/lib/live-projects";
import { WorkshopProjectFlow } from "./workshop-project-flow";

/**
 * 新建项目（`/project/new`）—— #4615（PROP-PROJECT-WORKSPACE-001 §3.4）：一步到位。
 *
 * 「项目」是通用工作空间（对话、白板、访谈、问卷、研究、设计与 AI 推演都收在里面），工作坊只是
 * 一种可选形态。默认路径只填**项目名称** → 「创建」→ `createProject({ kind: "general",
 * blueprintVersionId: null })` → 进入项目；下方一行次要入口「用工作坊模板创建」通往原来的
 * 工作坊向导（`?mode=workshop`，`WorkshopProjectFlow`，建 `kind: "workshop"`）。
 *
 * 原向导里只读展示、不写入后端的占位（时长档位 / 日期 / 人数 / 关联来源 / 六类初始化）
 * 不再出现在默认路径上——它们只和工作坊有关。
 *
 * 幂等：提交期间按钮禁用，失败后恢复可点（同工作坊向导的纪律）。
 */
export type NewProjectMode = "general" | "workshop";

export function resolveNewProjectMode(raw: string | string[] | undefined): NewProjectMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "workshop" ? "workshop" : "general";
}

export function NewProjectFlow({ mode = "general" }: { mode?: NewProjectMode }) {
  if (mode === "workshop") return <WorkshopProjectFlow />;
  return <GeneralProjectForm />;
}

function GeneralProjectForm() {
  const router = useRouter();
  const { session } = useSession();
  if (!session) throw new Error("NewProjectFlow requires an authenticated session");
  const orgId = session.currentOrgId;

  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ text: string; code: string | null } | null>(null);

  const trimmed = name.trim();
  const canSubmit = trimmed !== "" && !busy;

  const handleCreate = React.useCallback(async () => {
    if (trimmed === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await createProject({ orgId, name: trimmed, kind: "general", blueprintVersionId: null });
      router.push(`/projects/${encodeURIComponent(out.id)}?org=${encodeURIComponent(orgId)}`);
    } catch (e) {
      setError({ text: describeError(e), code: e instanceof ApiError ? e.reasonCode : null });
      setBusy(false);
    }
  }, [trimmed, busy, orgId, router]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 p-6" data-testid="project-new" data-mode="general">
      <header className="flex flex-col gap-2">
        <Button asChild size="sm" variant="outline" className="self-start" data-testid="project-new-back">
          <a href="/projects"><ChevronLeft aria-hidden className="h-3.5 w-3.5" />全部项目</a>
        </Button>
        <h1 className="text-20 font-semibold tracking-tight" data-testid="project-new-title">新建项目</h1>
        <p className="text-12 leading-relaxed text-muted-foreground">
          项目是团队的工作空间：对话、白板、访谈、问卷、研究、设计都收在一起，AI 在项目大脑里帮你推演结论。
          起个名字就能开始，内容进项目后再加。
        </p>
      </header>

      <Card>
        <form
          className="flex flex-col gap-3 p-4"
          data-testid="project-new-details"
          onSubmit={(e) => { e.preventDefault(); void handleCreate(); }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-11 text-muted-foreground">项目名称</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：新品上市调研"
              aria-label="项目名称"
              data-testid="project-new-name"
              className="h-9 text-12"
              autoFocus
            />
          </label>
          {error !== null ? (
            <p data-testid="project-new-error" data-reason={error.code ?? undefined} className="text-12 text-destructive">
              创建失败：{error.text}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" variant="primary" disabled={!canSubmit} data-testid="project-new-create">
              {busy ? "创建中…" : "创建"}
            </Button>
            <Button asChild size="sm" variant="ghost" className="transition-colors" data-testid="project-new-cancel">
              <a href="/projects">取消</a>
            </Button>
          </div>
        </form>
      </Card>

      <a
        href="/project/new?mode=workshop"
        data-testid="project-new-workshop-link"
        className="flex items-center gap-2 self-start rounded-md px-1 py-1 text-12 text-muted-foreground transition-colors duration-base hover:text-background-foreground"
      >
        <Presentation aria-hidden className="h-3.5 w-3.5" />
        要办一场工作坊？<span className="text-primary">用工作坊模板创建</span>
      </a>
    </div>
  );
}

/** 说人话，不上屏内部码（原因码留在 `data-reason` 上供排障 / e2e 断言）。 */
function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.reasonCode === "ORG_ROLE_INSUFFICIENT") return "你在当前组织的角色不能新建项目，请联系组织负责人。";
    if (e.status === 401) return "登录已失效，请重新登录。";
    return httpFailureText(e.status);
  }
  if (e instanceof TypeError) return "连不上服务器，检查一下网络再试。";
  return "出了点问题，稍后再试一次。";
}
