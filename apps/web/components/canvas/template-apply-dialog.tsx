"use client";
import * as React from "react";
import { Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { bindCanvasTemplateToSegment, type CanvasTemplate } from "@/lib/live-canvas";
import {
  getProjectOverview, listProjects, type ProjectListItem, type ProjectOverview,
} from "@/lib/live-projects";

/**
 * #493 —— 「在项目里真正**使用**一个 canvas 模板」的写入面（F102 / UC-7.1）。
 *
 * 核心闭环第 8c 步。#463 / #496 之前，模板这条线上只有「能建、能看」：五条注册表路由
 * 全都在动模板自己（谁有哪些模板、它们各处在哪一态），没有任何一条把模板**用出去**。
 * PR #505 把 `bindTemplateToSegment` 的 HTTP 边界接上，本组件是它在浏览器里的第一个调用方。
 *
 * ## 为什么落点是「议程环节」而不是「项目」
 *
 * 契约里「使用一个模板」的机械形态只有一个：`canvas_template_bindings` 里多一行，落点是
 * `agenda_segment_id`（迁移 20260805030000 指名它是 `usageCount` 与
 * `stillBoundSegmentCount` 的唯一事实源）。「把模板绑到项目上」在契约里不存在，
 * 在这里发明一个项目级绑定，就是造第二份「模板被用在哪」的事实。
 *
 * ## 环节从哪儿来：`GET /projects/:id/overview` 的**当前**环节，只此一处
 *
 * `listAgendaSegments` 在契约里（`project.operations.listAgendaSegments`）**但没有任何
 * controller 挂它**——`project.controller.ts` 上关于议程环节的路由只有 `.../advance`。
 * 所以今天前端能真实拿到的环节只有一个：概览白名单里的 `currentAgendaSegment`
 * （服务端逐字 `WHERE state = 'active'`）。
 *
 * ⚠ 因此这个对话框**不提供环节选择器**：一个只能选一项的下拉框会让人以为其余环节
 *   只是暂时没加载出来。界面如实说「绑到当前进行中的环节」，缺口报在 #493。
 * ⚠ 也**不**让用户手填一个环节 id。那是把「后端还没给读路径」这件事伪装成一个输入框，
 *   而填错的后果是一个 404，看起来像功能坏了。
 *
 * ## 这里不做判断
 *
 * 没有「你是不是引导师」的分支，也不预先过滤「哪些模板可绑」。裁决全在服务端
 * （`application/canvas/bind-template-to-segment.ts`：引导师判定走服务端那张唯一的项目角色
 * 矩阵，三条拒绝整个来自 `domain/canvas/segment-binding.ts`）。
 * ⚠ 上一句刻意**不**写出那张矩阵的常量名、也不抄它的任何一个动作词：
 *   `apps/api/tests/kernel/rbac-role-matrix.test.ts` 的「矩阵只有一个家」那条门会把
 *   前端里出现的这些字面量判成副本。实测：第一版写了常量名，那条门当场红。
 * 前端复述一遍那些判据，就是第二份 I-5 / I-6，而两份里被漏掉的那份不会有任何东西报警。
 * 失败信封原样回显。
 *
 * ## testid 前缀
 *
 * `canvas-template-*`——`core-loop.spec.ts` 第 8c 步锚的就是 `canvas-template-apply`。
 * 邻居 `template-admin.tsx` 用的是 `tpladmin-*`，本组件不去改它（那是 #464 / #496 的
 * 锚点，改名会让三个 spec 一起红在一个与本 issue 无关的原因上）。
 */
export function TemplateApplyDialog({
  template, orgId, onClose, onApplied,
}: {
  readonly template: CanvasTemplate;
  readonly orgId: string;
  readonly onClose: () => void;
  /** 绑定成功后由调用方**重新读一次列表**——不许把 usageCount 在本地加一，见下方注释。 */
  readonly onApplied: (message: string) => Promise<void> | void;
}) {
  const [projects, setProjects] = React.useState<readonly ProjectListItem[] | null>(null);
  const [projectId, setProjectId] = React.useState<string>("");
  const [overview, setOverview] = React.useState<ProjectOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // 只列**工作坊**：议程环节是工作坊机件（人类 2026-07-30 逐字，见 F118 迁移文件头），
  // 另两类容器根本不可能有环节，列出来只会让人选中之后撞一个空环节。
  React.useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const out = await listProjects(orgId);
        if (!live) return;
        const all = [...out.member, ...out.managed]
          .filter((p) => p.kind === "workshop" && p.status === "active")
          .filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i);
        setProjects(all);
      } catch (e) {
        if (live) setError(describeError(e));
      }
    })();
    return () => { live = false; };
  }, [orgId]);

  // 换项目就把上一个项目的环节**立刻**作废。留着它，用户会对着 A 项目的环节名
  // 按下一个打到 B 项目的绑定请求。
  React.useEffect(() => {
    if (projectId === "") { setOverview(null); return; }
    let live = true;
    setOverview(null);
    setLoadingOverview(true);
    setError(null);
    void (async () => {
      try {
        const out = await getProjectOverview(projectId);
        if (live) setOverview(out);
      } catch (e) {
        if (live) setError(describeError(e));
      } finally {
        if (live) setLoadingOverview(false);
      }
    })();
    return () => { live = false; };
  }, [projectId]);

  const segment = overview?.currentAgendaSegment ?? null;

  async function submit() {
    if (segment === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const out = await bindCanvasTemplateToSegment({
        agendaSegmentId: segment.id,
        templateKey: template.key,
        templateVersion: template.version,
      });
      // ⚠ 交给调用方去**重新读一次列表**，不在这里把 usageCount 本地加一：
      //   本地加一那一行看起来与真的一模一样，而「它到底进没进库」正是这条闭环
      //   唯一要证明的事（同 `template-admin.tsx` 的 `create` 那段注释）。
      await onApplied(
        `已把「${template.displayName}」用到环节「${segment.title}」·`
        + ` 绑定 ${out.bindingId} 固化版本 v${out.boundTemplateVersion}`,
      );
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
      aria-labelledby="canvas-template-apply-title"
      data-testid="canvas-template-apply-dialog"
    >
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <h2 id="canvas-template-apply-title" className="text-14 font-semibold">
            使用「{template.displayName} v{template.version}」
          </h2>
          <Button size="icon" variant="ghost" aria-label="关闭" onClick={onClose} data-testid="canvas-template-apply-close">
            <X aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>

        <p className="rounded-md border border-border-subtle bg-panel px-2.5 py-1.5 text-11 text-muted-foreground">
          绑到工作坊「当前进行中」的那个议程环节。绑定会固化此刻的版本号 v{template.version}：
          之后这个模板发新版、被归档或恢复，都不改写已有绑定（F102 冻结语义）。
        </p>

        <label className="flex flex-col gap-1 text-11">
          <span className="text-muted-foreground">工作坊</span>
          <select
            className="rounded-md border border-border bg-background px-2 py-1.5 text-12"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            data-testid="canvas-template-apply-project"
          >
            <option value="">选一个工作坊…</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {projects !== null && projects.length === 0 && (
            // 真实空态：这是服务端说的，不是「还没加载完」。
            <span className="text-10 text-muted-foreground" data-testid="canvas-template-apply-no-project">
              你不在任何进行中的工作坊里 —— 模板只能用在工作坊的议程环节上。
            </span>
          )}
        </label>

        <div className="flex flex-col gap-1 rounded-md border border-border bg-panel px-2.5 py-2" data-testid="canvas-template-apply-segment">
          <span className="text-10 uppercase tracking-wide text-muted-foreground">当前议程环节</span>
          {projectId === "" && <span className="text-11 text-muted-foreground">先选一个工作坊。</span>}
          {projectId !== "" && loadingOverview && (
            <span className="text-11 text-muted-foreground">正在读取该工作坊的当前环节…</span>
          )}
          {projectId !== "" && !loadingOverview && segment === null && (
            // 「没有进行中的环节」与「读失败」是两件事，不合并成一句「暂无」。
            <span className="text-11 text-warning" data-testid="canvas-template-apply-no-segment">
              这个工作坊现在没有进行中的议程环节，没有可落点的地方。
              （契约里的 `listAgendaSegments` 今天没有 controller 挂它，所以界面只拿得到当前环节 —— 缺口已随 #493 报出。）
            </span>
          )}
          {segment !== null && (
            <span className="text-12" data-testid={`canvas-template-apply-segment-${segment.id}`}>
              {segment.ordinal} {segment.title} · {segment.duration} 分钟 · {segment.state}
            </span>
          )}
        </div>

        {error && (
          <p
            className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-11 text-destructive"
            role="alert"
            data-testid="canvas-template-apply-error"
          >
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="canvas-template-apply-cancel">取消</Button>
          <Button
            size="sm"
            variant="primary"
            disabled={segment === null || submitting}
            onClick={() => void submit()}
            data-testid="canvas-template-apply"
          >
            <Play aria-hidden className="h-3.5 w-3.5" />
            {submitting ? "正在绑定…" : "用到这个环节"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * 后端真实信封原样回显。**只**把契约 `bindTemplateToSegment.err` 里真有的两个码翻成人话——
 * 它们是用户自己能处理的事；给别的码也各编一句友好文案，就是在前端造一份错误语义的副本，
 * 而它与契约之间没有任何东西会红（同 `template-admin.tsx` 的 `describeCreateError`）。
 */
function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.reasonCode === "SEGMENT_TEMPLATE_LIMIT") {
      return "这个环节已经绑了两个模板（上限 I-6）。先移除一个再绑（服务端 SEGMENT_TEMPLATE_LIMIT）";
    }
    if (error.reasonCode === "TEMPLATE_ARCHIVED") {
      return "只有已发布的模板才能被环节使用（服务端 TEMPLATE_ARCHIVED）";
    }
    return `${error.reasonCode ?? "无 reasonCode"}（HTTP ${error.status}）`;
  }
  if (error instanceof Error) return error.message;
  return "未知错误";
}
