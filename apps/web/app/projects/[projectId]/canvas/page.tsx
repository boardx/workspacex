import { AppShell } from "@/components/shell/app-shell";
import { CanvasMain } from "@/components/canvas/canvas-main";
import { CanvasLeftPanel } from "@/components/canvas/canvas-left-panel";
import { CanvasRightPanel } from "@/components/canvas/canvas-right-panel";
import { resolvePreviewState } from "@/lib/ui-state";
import { resolvePreviewRole } from "@/lib/identity";

/**
 * 推演画布（UC-7.3 / 原型第四节）
 *
 * 服务端组件：读 searchParams（state / as / org / conflict），套 AppShell 三栏。
 * 左栏三区（各组画布 / 本项目画布 / 绑定 skill）为纯展示；
 * 中栏 CanvasMain 与右栏 CanvasRightPanel 是客户端组件（工具选中、冲突裁决、AI 开关等交互）。
 * ⚠ 画布本体只是**壳与状态**，不接 mermaid 渲染引擎（属后续 feature）。
 *
 * ⚠ **issue #1316（安全修复）**：以前这里用 `?org=` 查一个写死的 mock 组织表来拼一份假身份
 *   （`lib/identity.ts` 的那个 mock-身份 helper）——与 `/projects/[projectId]` 同一根因，
 *   任何真实组织都会静默替换成写死的 mock org。
 *   现在不再在这里组装身份、也不再往 `AppShell` 传 `identity`：`AppShell` 落到
 *   `SessionProvider` 解析的真实会话身份，未登录会被重定向去 `/login`。
 */
export default function CanvasPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string; conflict?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  // 画布默认落在「组员/你在这组」视角；四种角色都可用顶部预览视角切换器切换
  const previewRole = resolvePreviewRole(searchParams.as);
  const initialConflict = searchParams.conflict === "on" || searchParams.conflict === "1";

  return (
    <AppShell
      previewRole={previewRole}
      left={<CanvasLeftPanel />}
      right={<CanvasRightPanel />}
    >
      <CanvasMain state={state} previewRole={previewRole} initialConflict={initialConflict} />
    </AppShell>
  );
}
