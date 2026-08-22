"use client";
import * as React from "react";
import { Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { trialCanvasTemplate, type CanvasTemplate } from "@/lib/live-canvas";
import { listProjects, type ProjectListItem } from "@/lib/live-projects";

/**
 * 模板管理可用性改进 #10 之六 —— 「试跑」入口的真实实现。
 *
 * ## 为什么这件事之前只有一句占位文案
 *
 * `trialTemplate`（`draft → trial`，契约 `canvas.operations.trialTemplate`）自 #463 起
 * 就是一条真实挂了的路由（`apps/api/src/application/canvas/trial-template.ts`），
 * `lib/live-canvas.ts` 的 `trialCanvasTemplate` 也早已存在——但在这个对话框之前，
 * 全仓没有任何 UI 调用过它。draft 行上原来只放一句「试跑入口待补（缺试跑项目的真实
 * 来源）」：那句话在 #493 落地「使用」入口（同样需要一个项目来源）之后已经不成立——
 * `listProjects(orgId)` 就是那个来源，`TemplateApplyDialog` 已经在用它。
 *
 * ## 与 `TemplateApplyDialog`（「使用」）的关键差异：不需要「当前议程环节」
 *
 * 「使用」绑的是 `agenda_segment_id`（服务端唯一读得到的是当前进行中的环节，见该文件
 * 头）；「试跑」只是把这一行模板的状态从 `draft` 推进到 `trial`，契约 `trialTemplate.in`
 * 只要一个 `projectId` 作校验入参（服务端如实说：这个 `projectId` 今天不落库，见
 * `trial-template.ts` 文件头），不涉及任何环节。所以这里**不**复用
 * `TemplateApplyDialog` 的环节读取那一段——多读一次 `GET /projects/:id/overview`
 * 只会让这个对话框多一个与「试跑」语义无关的加载态。
 *
 * ⚠ 与 `TemplateApplyDialog` 一样，只列**工作坊**（`kind === "workshop"` 且
 *   `status === "active"`）——试跑同样是工作坊机件，另两类容器选中后必然撞一个
 *   与「工作坊」概念不兼容的项目。
 */
export function TemplateTrialDialog({
  template, orgId, onClose, onTrialed,
}: {
  readonly template: CanvasTemplate;
  readonly orgId: string;
  readonly onClose: () => void;
  /** 成功后由调用方**重新读一次列表**——不在本对话框把 status 本地改成 "trial"。 */
  readonly onTrialed: (message: string) => Promise<void> | void;
}) {
  const [projects, setProjects] = React.useState<readonly ProjectListItem[] | null>(null);
  const [projectId, setProjectId] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const out = await listProjects(orgId);
        if (!live) return;
        setProjects(out.filter((p) => p.kind === "workshop" && p.status === "active"));
      } catch (e) {
        if (live) setError(describeError(e));
      }
    })();
    return () => { live = false; };
  }, [orgId]);

  async function submit() {
    if (projectId === "") return;
    setSubmitting(true);
    setError(null);
    try {
      await trialCanvasTemplate({ key: template.key, version: template.version, projectId });
      await onTrialed(`「${template.displayName} v${template.version}」已进入试跑`);
    } catch (e) {
      setError(describeError(e));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="canvas-template-trial-title"
      data-testid="tpladmin-trial-dialog"
    >
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <h2 id="canvas-template-trial-title" className="text-14 font-semibold">
            试跑「{template.displayName} v{template.version}」
          </h2>
          <Button size="icon" variant="ghost" aria-label="关闭" onClick={onClose} data-testid="tpladmin-trial-close">
            <X aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>

        <p className="rounded-md border border-border-subtle bg-panel px-2.5 py-1.5 text-11 text-muted-foreground">
          试跑把这一行从「草稿」推进到「试跑」，仍未发布——发布前它不会出现在环节可绑定的清单里。
          选一个工作坊只用作服务端的校验入参，本次试跑**不会**在该工作坊里留下任何记录（服务端如实
          不落库这一栏，缺口已随 #463 报出）。
        </p>

        <label className="flex flex-col gap-1 text-11">
          <span className="text-muted-foreground">工作坊</span>
          <select
            className="rounded-md border border-border bg-background px-2 py-1.5 text-12"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            data-testid="tpladmin-trial-project"
          >
            <option value="">选一个工作坊…</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {projects !== null && projects.length === 0 && (
            <span className="text-10 text-muted-foreground" data-testid="tpladmin-trial-no-project">
              你不在任何进行中的工作坊里 —— 试跑需要一个工作坊作为入参。
            </span>
          )}
        </label>

        {error && (
          <p
            className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-11 text-destructive"
            role="alert"
            data-testid="tpladmin-trial-error"
          >
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="tpladmin-trial-cancel">取消</Button>
          <Button
            size="sm"
            variant="primary"
            disabled={projectId === "" || submitting}
            onClick={() => void submit()}
            data-testid="tpladmin-trial-submit"
          >
            <Play aria-hidden className="h-3.5 w-3.5" />
            {submitting ? "正在提交…" : "开始试跑"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 后端真实信封原样回显：同 `template-apply-dialog.tsx` 的 `describeError` 一贯做法。 */
function describeError(error: unknown): string {
  if (error instanceof ApiError) return `${error.reasonCode ?? "无 reasonCode"}（HTTP ${error.status}）`;
  if (error instanceof Error) return error.message;
  return "未知错误";
}
