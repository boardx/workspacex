"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveAsOrgTemplate, describeSaveAsOrgTemplateError } from "@/lib/live-workflow-orchestration";

/**
 * #1666 收尾 —— 「另存为组织模板」共享交互，`tab-prep.tsx`（`project-prep-save-template`）
 * 与 `workflow-screen.tsx`（`tpl-wf-saveorg`）两处按钮的唯一实现。
 *
 * ## 为什么两个屏共用一个组件，不是各自照抄一份
 *
 * 两处按钮语义完全相同（都是把「这个项目此刻的工作流编排」另存成一条新的后台工作流
 * 模板目录项，命中同一个契约操作 `saveAsOrgTemplate`），唯一的差别是外层触发按钮的
 * 视觉样式（`tab-prep.tsx` 是 `ghost`，`workflow-screen.tsx` 是 `outline` + 图标）与
 * testid 前缀。样式差异交给调用方的 `renderTrigger`，状态机（展开/命名/提交/成功/失败）
 * 只写一份——同本仓「同一事实不得声明在两处」的既有纪律（AGENTS.md）。
 *
 * ## 这里之前是什么（issue #1666 的原始缺陷）
 *
 * `tab-prep.tsx:135` 的按钮**没有 `onClick`**，纯装饰；`workflow-screen.tsx:58` 的按钮
 * 只 `onToast("已另存为组织级工作流模板…")`，**不发任何网络请求**——两处都是「假成功」：
 * 用户看到成功提示，但库里什么也没写。本组件把两处都接上真实
 * `POST /projects/:projectId/save-as-org-template`：成功显示服务端真实返回的
 * `workflowTemplateId`（不是编好的固定文案），失败原样显示服务端 reasonCode
 * （`describeSaveAsOrgTemplateError`），不再本地伪造成功。
 *
 * ## 为什么要求填「模板名称」，不是点一下就存
 *
 * 契约 `saveAsOrgTemplate.in.name` 是 `z.string().min(1)`——服务端要求非空名称，
 * 前端如果不收集就会恒定传空串，永远拿到一个 400 形状的校验失败。
 */
export function SaveAsOrgTemplateAction({
  projectId, testIdPrefix, renderTrigger, onSaved,
}: {
  projectId: string;
  /** testid 前缀，如 `project-prep-save-template` / `tpl-wf-saveorg`——两屏各自的既有约定。 */
  testIdPrefix: string;
  /** 折叠态触发按钮——外观由调用方决定，点击后调用给定的 `open()` 展开表单。 */
  renderTrigger: (open: () => void, testId: string) => React.ReactNode;
  /** 保存成功后的回调（例如给上层一个可以透传给外部 toast 的真实文案）。 */
  onSaved?: (out: { workflowTemplateId: string; name: string }) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<{ workflowTemplateId: string; name: string } | null>(null);

  const startOpen = () => {
    setName("");
    setError(null);
    setOpen(true);
  };
  const cancel = () => {
    setOpen(false);
    setError(null);
  };

  async function submit() {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("模板名称不能为空");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await saveAsOrgTemplate(projectId, trimmed);
      setSuccess({ workflowTemplateId: out.workflowTemplateId, name: trimmed });
      setOpen(false);
      onSaved?.({ workflowTemplateId: out.workflowTemplateId, name: trimmed });
    } catch (e) {
      setError(describeSaveAsOrgTemplateError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open
        ? renderTrigger(startOpen, testIdPrefix)
        : (
          <div className="flex flex-wrap items-center gap-2" data-testid={`${testIdPrefix}-form`}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="组织模板名称"
              className="h-8 w-48 text-11"
              data-testid={`${testIdPrefix}-name`}
            />
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => void submit()}
              data-testid={`${testIdPrefix}-submit`}
            >
              {busy ? "保存中…" : "保存"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={cancel} data-testid={`${testIdPrefix}-cancel`}>
              取消
            </Button>
          </div>
        )}

      {error !== null && (
        <p role="alert" className="text-10 text-destructive" data-testid={`${testIdPrefix}-error`}>
          {error}
        </p>
      )}
      {success !== null && (
        <p className="text-10 text-success" data-testid={`${testIdPrefix}-success`}>
          已另存为组织模板「{success.name}」· id {success.workflowTemplateId}
        </p>
      )}
    </>
  );
}
