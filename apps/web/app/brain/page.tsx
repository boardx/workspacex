import { AppShell } from "@/components/shell/app-shell";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { resolvePreviewState } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { BrainWorkbench } from "@/components/brain/workbench";
import { BrainLeftRail } from "@/components/brain/left-rail";

/**
 * 组织大脑 —— 三层记忆模型 + Context Pack 可审查面。
 * 覆盖 UC-14.6（检索可审查 / AI 读到了什么）、UC-14.4（决策台账）、
 * UC-14.5（五态机与晋升）、UC-14.2（横向复用）。
 *
 * 服务端组件读 searchParams；Tabs 与所有交互下沉到 `"use client"` 的 BrainWorkbench。
 */
export default function BrainPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);

  return (
    <AppShell identity={identity} previewRole={previewRole} left={<BrainLeftRail />}>
      <div className="flex flex-col">
        <div className="border-b border-border-subtle px-5 py-2">
          <StatePreviewSwitcher current={state} />
        </div>
        <BrainWorkbench state={state} />
      </div>
    </AppShell>
  );
}
