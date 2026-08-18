"use client";
import * as React from "react";
import { useSession } from "@/components/session/session-provider";
import { BlueprintDesignerShell } from "./blueprint-designer-shell";
import { DESIGN_FACET_CATALOG } from "@/lib/generated/design-facet-catalog";
import { ApiError } from "@/lib/api-client";
import { listBlueprints, getBlueprintDesignFacets, updateDesignFacet, type BlueprintRow, getInitializationPreview, setDurationTier, type GetInitializationPreviewOut } from "@/lib/live-blueprints";
import type { FacetSaveFn } from "./facet-content-editor";

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
 * ## 这次接了什么、没接什么（2026-08-17 更新：D-05 二级 sign-off 已签核，补上编辑面板）
 *
 * 接：蓝本名称、版本条（真实 state/versionNumber/appliedProjectCount）、
 *   完成度（真实 done/denominator，且编辑后从 `updateDesignFacet` 的响应即时刷新，
 *   不是前端本地拍的）、已填 key 高亮（真实 designFacets）、**16 项配置的真实可编辑
 *   面板**（`design-deltas/blueprint-design-facet-panels/` 已签核，解开 D-05 二级
 *   sign-off；见 `facet-content-editor.tsx` 与 `blueprint-designer-shell.tsx` 的
 *   `FacetPanel`）。
 * 没接：
 *   · 试跑/发布/预览三个按钮——外壳组件本身没有 onClick 落点（原型与真栈都一样，
 *     不是本次退化），接它们要先给外壳加事件回调 props，属于下一个增量。
 *   · ~~换时长档位~~ —— **已于 F207 接线**（第 16 项「基本配置」聚合页）：
 *     `live-blueprints.ts` 已封装 `setDurationTier`，`expectedVersion` 取自
 *     `listBlueprints` 那一行的 `versionNumber`（BlueprintRow 一直含这个字段）。
 *   · ~~16 项面板统一走自由文本编辑~~ —— **已于 F204–F207 补齐**：15 个 designFacetKey
 *     各有专属结构化编辑器（路由表见 `facet-editor-registry.ts`），第 16 项「基本配置」
 *     是聚合页。`FacetTextEditor` 退化为仅兜底。契约形状仍是 `content: z.string()`
 *     （一字未改），变的只是往这个字符串里写结构化 JSON 而不是任意文本。
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
  const [facets, setFacets] = React.useState<
    { designFacetKey: string; content: string; itemRevision: string }[] | null
  >(null);
  /** 独立于 `row.completeness`——保存一项后从 `updateDesignFacet` 的响应即时更新，
   *  不必等一次全量 `load()` 才刷新数字（但数字仍然是后端算出来的，不是前端本地拍的）。 */
  const [completeness, setCompleteness] = React.useState<{ done: number; denominator: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  /** 第 16 项「基本配置」的初始化预览——服务端派生的只读视图，与 facet 读写无关。 */
  const [preview, setPreview] = React.useState<GetInitializationPreviewOut | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

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
        setCompleteness(null);
        return;
      }
      setRow(found);
      setFacets([...facetsOut.designFacets]);
      setCompleteness(found.completeness);

      // 初始化预览单独取、单独报错：它是第 16 项里的一节，读不到时那一节如实报错，
      // 不能让整个设计器打不开（其余 15 项的读写与它无关）。
      try {
        setPreviewError(null);
        setPreview(await getInitializationPreview(id));
      } catch (e) {
        setPreview(null);
        setPreviewError(describeError(e));
      }
    } catch (e) {
      setError(describeError(e));
      setRow(null);
      setFacets(null);
      setCompleteness(null);
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * 真实调用 `updateDesignFacet`——乐观并发用调用方（`FacetTextEditor`/
   * `PermissionMatrixEditor`）传入的 `expectedItemRevision`；成功后本地更新
   * `facets`（下次进这个面板/切到别的面板再切回来看到的是刚保存的内容）与
   * `completeness`（响应自带，服务端算的，不是本地数出来的）。
   */
  const handleSaveFacet: FacetSaveFn = React.useCallback(
    async (designFacetKey, value, expectedItemRevision) => {
      if (blueprintId === null) throw new Error("no blueprintId");
      const out = await updateDesignFacet({ blueprintId, designFacetKey, value, expectedItemRevision });
      setFacets((prev) => {
        const others = (prev ?? []).filter((f) => f.designFacetKey !== designFacetKey);
        if (value.trim() === "") return others; // 清空内容 = 这一项重新变为"未填"，不留一条空内容的行
        return [...others, { designFacetKey, content: value, itemRevision: out.itemRevision }];
      });
      setCompleteness(out.completeness);
      return { itemRevision: out.itemRevision, completeness: out.completeness };
    },
    [blueprintId],
  );

  /**
   * 第 16 项换时长档位。`confirmed:false` 是预检（后端回 CONFIRMATION_REQUIRED 并附上
   * 将增删的环节），`confirmed:true` 才落库——两步都由面板发起，这里只负责真实调用与
   * 成功后重读（环节数与完成度都会变，必须以服务端重读为准，不本地推算）。
   */
  const handleSetTier = React.useCallback(
    async (tier: Parameters<typeof setDurationTier>[0]["tier"], confirmed: boolean) => {
      if (blueprintId === null || row === null) throw new Error("no blueprint loaded");
      const out = await setDurationTier({
        blueprintId,
        tier,
        confirmed,
        expectedVersion: String(row.versionNumber),
      });
      if (confirmed) await load(blueprintId, orgId);
      return out;
    },
    [blueprintId, orgId, row, load],
  );

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

  if (error !== null || row === null || facets === null || completeness === null) {
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
      completeness={completeness}
      completedKeys={completedKeys}
      firstIncompleteRequiredKey={null}
      autosave={{ status: "never-saved", lastSavedAt: null, failure: null }}
      designFacets={facets}
      onSaveFacet={handleSaveFacet}
      basicOverview={{
        currentTier: row.durationTier,
        agendaSegmentCount: row.agendaSegmentCount,
        preview,
        previewError,
        onSetTier: handleSetTier,
      }}
    />
  );
}

function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.reasonCode ?? `加载失败（HTTP ${e.status}）`;
  if (e instanceof Error) return e.message;
  return "未知错误";
}
