import { AppShell } from "@/components/shell/app-shell";
import { CanvasMain } from "@/components/canvas/canvas-main";
import { CanvasLeftPanel } from "@/components/canvas/canvas-left-panel";
import { CanvasRightPanel } from "@/components/canvas/canvas-right-panel";
import { resolvePreviewState } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";

/**
 * 推演画布（UC-7.3 / 原型第四节）
 *
 * 服务端组件：读 searchParams（state / as / org / conflict），套 AppShell 三栏。
 * 左栏三区（各组画布 / 本项目画布 / 绑定 skill）为纯展示；
 * 中栏 CanvasMain 与右栏 CanvasRightPanel 是客户端组件（工具选中、冲突裁决、AI 开关等交互）。
 * ⚠ 画布本体只是**壳与状态**，不接 mermaid 渲染引擎（属后续 feature）。
 */
export default function CanvasPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string; conflict?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  // 画布默认落在「组员/你在这组」视角；四种角色都可用顶部预览视角切换器切换
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);
  const initialConflict = searchParams.conflict === "on" || searchParams.conflict === "1";

  return (
    <AppShell
      identity={identity}
      previewRole={previewRole}
      left={<CanvasLeftPanel />}
      right={<CanvasRightPanel />}
    >
      <CanvasMain state={state} previewRole={previewRole} initialConflict={initialConflict} />
    </AppShell>
  );
}
