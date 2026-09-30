"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import { useSession } from "@/components/session/session-provider";
import { createProject } from "@/lib/live-projects";

/**
 * 「新建通用项目」表单体（#4743）—— 弹窗（`CreateProjectDialog`）与 `/project/new` 页内联共用同一份，
 * testid 一字不改（project-new-details / -name / -error(+data-reason) / -create / -cancel），e2e 不论表单
 * 住在哪都能用。只填**项目名称** → `createProject({ kind: "general", blueprintVersionId: null })` →
 * `router.push('/projects/<id>?org=<org>')`。提交期间按钮禁用，失败后恢复可点。
 */
export function CreateProjectForm({
  cancel,
  className,
  autoFocus = true,
}: {
  /** 取消控件由调用方给（弹窗里是关闭按钮，页面里是回列表的链接）。 */
  cancel: React.ReactNode;
  className?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const { session } = useSession();
  if (!session) throw new Error("CreateProjectForm requires an authenticated session");
  const orgId = session.currentOrgId;

  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ text: string; code: string | null } | null>(null);
  const lock = React.useRef(false);

  const trimmed = name.trim();
  const canSubmit = trimmed !== "" && !busy;

  const handleCreate = React.useCallback(async () => {
    if (trimmed === "" || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const out = await createProject({ orgId, name: trimmed, kind: "general", blueprintVersionId: null });
      router.push(`/projects/${encodeURIComponent(out.id)}?org=${encodeURIComponent(orgId)}`);
    } catch (e) {
      setError({ text: describeCreateProjectError(e), code: e instanceof ApiError ? e.reasonCode : null });
      setBusy(false);
      lock.current = false;
    }
  }, [trimmed, orgId, router]);

  return (
    <form
      className={className ?? "flex flex-col gap-3"}
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
          disabled={busy}
          autoFocus={autoFocus}
        />
      </label>
      {error !== null ? (
        <p role="alert" data-testid="project-new-error" data-reason={error.code ?? undefined} className="text-12 text-destructive">
          创建失败：{error.text}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        {cancel}
        <Button type="submit" size="sm" variant="primary" disabled={!canSubmit} data-testid="project-new-create">
          {busy ? "创建中…" : "创建"}
        </Button>
      </div>
    </form>
  );
}

/** 说人话，不上屏内部码（原因码留在 `data-reason` 上供排障 / e2e 断言）。 */
export function describeCreateProjectError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.reasonCode === "ORG_ROLE_INSUFFICIENT") return "你在当前组织的角色不能新建项目，请联系组织负责人。";
    if (e.status === 401) return "登录已失效，请重新登录。";
    return httpFailureText(e.status);
  }
  if (e instanceof TypeError) return "连不上服务器，检查一下网络再试。";
  return "出了点问题，稍后再试一次。";
}
