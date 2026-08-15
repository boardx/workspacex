import { AppShell } from "@/components/shell/app-shell";
import { BlueprintDesignerPageLive } from "@/components/tpl-designer/blueprint-designer-page-live";
import { resolvePreviewRole } from "@/lib/identity";

/**
 * 蓝本设计器外壳的**真实挂载点**（F18，BP-06 接线）。
 *
 * 与 `/tpl?screen=designer` 的**原型屏**并存，二者不是一回事——同 `/admin/members`（已建成）
 * 与 `/org-admin/preview`（原型）的关系：原型屏是签核第 ① 件的材料，本页是产品实现。
 *
 * ## 这次从 mock 切到真实的是什么（诚实登记）
 *
 * 之前无论访问者是谁，一律显示 `lib/mock/tpl.ts` 的 `BLUEPRINTS[0]`，路由不接受
 * `blueprintId`。现在按真实 `?blueprintId=` 读真实数据（`BlueprintDesignerPageLive`，
 * F186 的 `getBlueprintDesignFacets` + 既有 `listBlueprints`）——细节见该组件头注。
 *
 * 顺带修正：本页此前用 `mockIdentity()` 兜底身份（同 issue #1316 点名的那类问题，
 * 这份 mock 用量本来就该在切真实数据时一起去掉，不是专门为 #1316 顺路加的范围）——
 * 现在同 `/tpl/list` 页的写法，`AppShell` 不传 `identity` 时自己读真实会话。
 *
 * ## 数据从哪来
 *
 * · **目录 / 分组 / 分母** ← `lib/generated/design-facet-catalog.ts`，
 *   由 `apps/api` 的配置项定义表机械生成、有漂移门控。这一半从一开始就是真的单源。
 * · **蓝本本身的事实**（名称、版本、已配哪几项）← 真实 `GET /blueprints` +
 *   `GET /blueprints/:id/design-facets`（F186）。
 * · **设计环节内容的编辑、试跑/发布按钮的交互** —— 仍未接线，见
 *   `blueprint-designer-page-live.tsx` 头注「这次接了什么、没接什么」。
 */
export default function BlueprintDesignerPage({
  searchParams,
}: {
  searchParams: { as?: string; blueprintId?: string };
}) {
  const previewRole = resolvePreviewRole(searchParams.as);
  const blueprintId = typeof searchParams.blueprintId === "string" && searchParams.blueprintId !== ""
    ? searchParams.blueprintId
    : null;

  return (
    <AppShell previewRole={previewRole}>
      <BlueprintDesignerPageLive blueprintId={blueprintId} />
    </AppShell>
  );
}
