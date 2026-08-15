"use client";
import * as React from "react";
import { useSession } from "@/components/session/session-provider";
import { BlueprintDesignerShell } from "./blueprint-designer-shell";
import { DESIGN_FACET_CATALOG } from "@/lib/generated/design-facet-catalog";
import { ApiError } from "@/lib/api-client";
import { listBlueprints, getBlueprintDesignFacets, type BlueprintRow } from "@/lib/live-blueprints";

/**
 * BP-06（F1xx）—— 蓝本设计器 `/tpl/designer` 真实接线的读半边。
 *
 * ## 与之前（BLUEPRINT[0] 硬编码）的区别
 *
 * `apps/web/app/tpl/designer/page.tsx` 此前无论访问者是谁，一律显示
 * `lib/mock/tpl.ts` 的 `BLUEPRINTS[0]`——路由不接受 `blueprintId`，接了也用不上。
 * 本组件按真实 `?blueprintId=` 读 `GET /blueprints`（找那一行）+
 * `GET /blueprints/:id/design-facets`（F186，读已填内容），拼出
 * `BlueprintDesignerShellProps` 喂给外壳——外壳本身是纯投影，不用改。
 *
 * ## 这次接了什么、没接什么
 *
 * 接：蓝本名称、版本条（真实 state/versionNumber/appliedProjectCount）、
 *   完成度（真实 done/denominator）、已填 key 高亮（真实 designFacets）。
 * 没接：
 *   · 设计环节内容的编辑面板——外壳自己的头注写着「二级 sign-off（D-05 待补抽取）」，
 *     没有签核过的界面设计，不能自己发明一个填。
 *   · 试跑/发布/预览三个按钮——外壳组件本身没有 onClick 落点（原型与真栈都一样，
 *     不是本次退化），接它们要先给外壳加事件回调 props，属于下一个增量。
 *   · 换时长档位——设计器页面没有对应交互入口，`live-blueprints.ts` 也还没封装
 *     `setDurationTier`（T13 契约缺口已被 F186 解决，纯粹是前端还没做这块交互）。
 *
 * ## `nextVersionNumber` 的算法说明（不是编的数）
 *
 * 真正权威的「下一个版本号」由后端 `publishNewVersion`（`domain/templates/
 * publish-blueprint-version.ts`）在**真正发布那一刻**从完整版本历史算出
 * （历史最大号 + 1）。本页面没有拉取完整版本历史的读端点，只有当前
 * `versionNumber`——在没有回滚的前提下（回滚端点至今未实现），
 * 「当前版本号 + 1」与「历史最大号 + 1」结果相同，这里用它做展示提示，
 * 真正发布时以后端计算为准，不会因为这里显示错而真的发错版本号。
 */
export function BlueprintDesignerPageLive({ blueprintId }: { blueprintId: string | null }) {
  const { session } = useSession();
  if (!session) throw new Error("BlueprintDesignerPageLive requires an authenticated session");
  const orgId = session.currentOrgId;

  const [row, setRow] = React.useState<BlueprintRow | null>(null);
  const [facets, setFacets] = React.useState<{ designFacetKey: string; content: string }[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async (id: string, org: string) => {
    setBusy(true);
    setError(null);
    try {
      const [rows, facetsOut] = await Promise.all([listBlueprints(org), getBlueprintDesignFacets(id)]);
      const found = rows.find((r) => r.blueprintId === id) ?? null;
      if (found === null) {
        setError("这个蓝本不在你的组织里，或已被删除");
        setRow(null);
        setFacets(null);
        return;
      }
      setRow(found);
      setFacets([...facetsOut.designFacets]);
    } catch (e) {
      setError(describeError(e));
      setRow(null);
      setFacets(null);
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    if (blueprintId === null) return;
    void load(blueprintId, orgId);
  }, [blueprintId, orgId, load]);

  if (blueprintId === null) {
    return (
      <p className="p-6 text-12 text-muted-foreground" data-testid="bp-designer-missing-id">
        缺少要打开的蓝本——请从「项目模板」列表页点「编辑设计」进入。
      </p>
    );
  }

  if (busy || (row === null && error === null)) {
    return <p className="p-6 text-12 text-muted-foreground" data-testid="bp-designer-loading">加载中…</p>;
  }

  if (error !== null || row === null || facets === null) {
    return <p className="p-6 text-12 text-destructive" data-testid="bp-designer-load-error">{error ?? "加载失败"}</p>;
  }

  const completedKeys = facets.filter((f) => f.content.trim() !== "").map((f) => f.designFacetKey);

  return (
    <BlueprintDesignerShell
      blueprintName={row.name}
      versionBar={{
        state: row.state,
        publishedVersionNumber: row.state === "draft" ? null : row.versionNumber,
        nextVersionNumber: row.versionNumber + 1,
        appliedProjectCount: row.appliedProjectCount,
      }}
      actions={[
        { id: "preview-participant-view", versionNumber: null },
        { id: "trial-run", versionNumber: null },
        { id: "publish", versionNumber: row.versionNumber + 1 },
      ]}
      catalog={DESIGN_FACET_CATALOG}
      completeness={row.completeness}
      completedKeys={completedKeys}
      firstIncompleteRequiredKey={null}
      autosave={{ status: "never-saved", lastSavedAt: null, failure: null }}
    />
  );
}

function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.reasonCode ?? `加载失败（HTTP ${e.status}）`;
  if (e instanceof Error) return e.message;
  return "未知错误";
}
