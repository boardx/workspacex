import { AppShell } from "@/components/shell/app-shell";
import { BlueprintDesignerShell } from "@/components/tpl-designer/blueprint-designer-shell";
import { DESIGN_FACET_CATALOG } from "@/lib/generated/design-facet-catalog";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { BLUEPRINTS, VERSION_HISTORY, CONFIG_ITEMS } from "@/lib/mock/tpl";

/**
 * 蓝本设计器外壳的**真实挂载点**（F18）。
 *
 * 与 `/tpl?screen=designer` 的**原型屏**并存，二者不是一回事——同 `/admin/members`（已建成）
 * 与 `/org-admin/preview`（原型）的关系：原型屏是签核第 ① 件的材料，本页是产品实现。
 *
 * ## 数据从哪来（诚实登记，不粉饰）
 *
 * · **目录 / 分组 / 分母** ← `lib/generated/design-facet-catalog.ts`，
 *   由 `apps/api` 的配置项定义表机械生成、有漂移门控。这一半是**真的单源**。
 * · **蓝本本身的事实**（名称、v4、用过 12 次、哪几项已配）← 原型 mock。
 *   templates 束的 HTTP 路由（`listDesignFacetDefinitions` / `updateDesignFacet`）
 *   今天**还不存在**，本页在它落地前是 mock 接线。⚠ 这块接线里的
 *   「下一版号 = 历史最大号 + 1」是**接线处的临时算式**，权威实现是
 *   `apps/api/src/domain/templates/designer-shell.ts` 的 `deriveVersionBar`
 *   （由 `designer-shell-version-bar.test.ts` 断言）——真接上 API 时删掉这里，不是删那里。
 * · **自动保存**：本页没有写路径，故显示上次成功保存时刻；失败态的界面表现由
 *   `blueprint-designer-shell.test.tsx` 直接断言，不靠这里制造。
 */
export default function BlueprintDesignerPage({
  searchParams,
}: {
  searchParams: { as?: string; org?: string };
}) {
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);

  const blueprint = BLUEPRINTS[0]!;
  const nextVersionNumber = VERSION_HISTORY.reduce((max: number, v) => Math.max(max, v.versionNumber), 0) + 1;
  const completedKeys = CONFIG_ITEMS.filter((i) => i.done).map((i) => i.key);
  const catalogKeys = new Set(DESIGN_FACET_CATALOG.groups.flatMap((g) => g.items.map((i) => i.designFacetKey)));
  const done = completedKeys.filter((k) => catalogKeys.has(k));

  return (
    <AppShell identity={identity} previewRole={previewRole}>
      <BlueprintDesignerShell
        blueprintName={blueprint.name}
        versionBar={{
          state: blueprint.state === "draft" ? "draft" : "published",
          publishedVersionNumber: blueprint.version,
          nextVersionNumber,
          appliedProjectCount: blueprint.usedCount,
        }}
        actions={[
          { id: "preview-participant-view", versionNumber: null },
          { id: "trial-run", versionNumber: null },
          { id: "publish", versionNumber: nextVersionNumber },
        ]}
        catalog={DESIGN_FACET_CATALOG}
        completeness={{ done: done.length, denominator: DESIGN_FACET_CATALOG.denominator }}
        completedKeys={done}
        firstIncompleteRequiredKey={null}
        autosave={{ status: "saved", lastSavedAt: "14:52", failure: null }}
      />
    </AppShell>
  );
}
