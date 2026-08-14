import Link from "next/link";
import { CanvasTemplateGallery } from "@/components/canvas/canvas-template-gallery";
import { resolvePreviewState, UI_STATES, UI_STATE_LABEL } from "@/lib/ui-state";
import { PROJECT_ROLE_LABEL, PROJECT_ROLES, resolvePreviewRole } from "@/lib/identity";

/**
 * 「新建画布 → 选模板」画廊 · UI 先行原型入口（ADR-003 / ADR-023 签核第 ① 件材料）。
 *
 * ⚠ 纯前端 mock，**不接后端**。展示 `packages/fabric-markdown` 里**已迁移就绪**的 19 个工作坊
 *   模板 +（mindmap / 空白）两个起点；选中后交给**真实** `CanvasStage` 渲染，证明
 *   「选了模板 → 画布从那个模板起手」链路在原型里是通的。
 *
 * query（预览手段，非权限实现）：
 *   ?state= default|loading|empty|invalid|dep-failed|denied|success  —— 逐态核对
 *   ?as=    facilitator|groupLead|member|observer                    —— R5 多角色视角切换
 */
export default function CanvasTemplateGalleryPreviewPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      {/* 界面态切换器 */}
      <nav className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5" data-testid="canvas-tpl-state-nav">
        <span className="mr-1 text-11 font-medium text-muted-foreground">界面态</span>
        {UI_STATES.map((s) => {
          const active = s === state;
          return (
            <Link
              key={s}
              href={`/preview/canvas-template-gallery?state=${s}&as=${previewRole ?? "facilitator"}`}
              data-testid={`canvas-tpl-state-${s}`}
              data-active={active}
              className={`rounded-full border px-2.5 py-1 text-11 transition-colors duration-200 ${
                active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-card-foreground hover:bg-muted"
              }`}
            >
              {UI_STATE_LABEL[s]}
            </Link>
          );
        })}
      </nav>

      {/* R5 角色视角切换器（预览手段） */}
      <nav className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle px-4 py-2" data-testid="canvas-tpl-role-nav">
        <span className="mr-1 text-11 font-medium text-muted-foreground">预览视角</span>
        {PROJECT_ROLES.map((r) => {
          const active = r === previewRole;
          return (
            <Link
              key={r}
              href={`/preview/canvas-template-gallery?state=${state}&as=${r}`}
              data-testid={`canvas-tpl-role-${r}`}
              data-active={active}
              className={`rounded-full border px-2.5 py-0.5 text-11 transition-colors duration-200 ${
                active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              {PROJECT_ROLE_LABEL[r]}
            </Link>
          );
        })}
        <span className="ml-auto text-10 text-muted-foreground">
          原型 · 纯前端 mock（不接后端）· 真实 CanvasStage 渲染模板起手
        </span>
      </nav>

      {/* 模态：真实项目画布页上，「新建画布」点开的覆盖层（此处平铺呈现供签核） */}
      <div className="flex flex-1 items-stretch justify-center bg-background/40 p-4">
        <div className="flex w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-lg" style={{ minHeight: 560 }}>
          <CanvasTemplateGallery state={state} previewRole={previewRole} />
        </div>
      </div>
    </main>
  );
}
