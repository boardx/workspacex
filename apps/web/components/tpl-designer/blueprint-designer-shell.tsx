"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DesignFacetCatalog } from "@/lib/generated/design-facet-catalog";
import type { FacetSaveFn } from "./facet-content-editor";
import { getFacetEditor } from "./facet-editor-registry";

/**
 * 蓝本设计器**外壳**（F18 / `uc-2-1` R3 §3.0 + R8）。
 *
 * ## 它为什么不在 `components/tpl/`
 *
 * `components/tpl/` 是**原型屏**（签核第 ① 件的材料），整目录被
 * `lint-design-facet-single-source.mjs` 列为已知 DEBT——那里的违规只会被**计数**，
 * 不会让门控变红。新写的真实实现放进去等于自动获得豁免。本文件放在 DEBT 之外，
 * 让同一道门控对它**零容忍**。
 *
 * ## 它是一个**投影**，不是一个数据源
 *
 * 目录、分组、分母、完成度、版本号、自动保存状态**全部从 props 进来**（服务端派生）。
 * 本文件里**没有**任何配置项 key、没有五组的清单、没有 15/16 —— 一个都没有。
 * 唯一在这里的是**界面文案**：
 *   · 版本条那半句「改动生成 v{n}，已开过的项目锁在自己的版本上」——R8 的
 *     「必须原样呈现」清单，它是用户敢改蓝本的前提，不是装饰文案；
 *   · 三个动作的按钮名。
 * 界面文案属渲染层；数字属领域层。分工可断言：数字错了后端测试红，句子少了半句前端测试红。
 *
 * ## 自动保存显示的是 V12 那条硬规矩
 *
 * 保存失败时**不得**继续显示「草稿自动保存」。本组件失败态渲染的是
 * `role="alert"` 的失败条 + 「上次成功保存」+ 「内容仍留在本页」——
 * 失败看得见、草稿不丢，两件同时成立（`draft-autosave.ts` 的同名两条不变量）。
 */

/** 版本条要用的变量。⚠ 全部由服务端派生（`deriveVersionBar`），前端不算 */
export interface DesignerVersionBar {
  readonly state: "draft" | "published" | "archived";
  /** 草稿态为 null —— 「没有版本号」不是「第 0 版」 */
  readonly publishedVersionNumber: number | null;
  readonly nextVersionNumber: number;
  readonly appliedProjectCount: number;
}

export interface DesignerActionView {
  readonly id: string;
  readonly versionNumber: number | null;
}

export interface DesignerAutosaveView {
  readonly status: "never-saved" | "saving" | "saved" | "failed";
  readonly lastSavedAt: string | null;
  readonly failure: string | null;
}

/** 一项已填/未填内容的真实来源——`getBlueprintDesignFacets` 的输出行，未填的 key 不在数组里。 */
export interface DesignerFacetRow {
  readonly designFacetKey: string;
  readonly content: string;
  readonly itemRevision: string;
}

export interface BlueprintDesignerShellProps {
  readonly blueprintName: string;
  readonly versionBar: DesignerVersionBar;
  readonly actions: readonly DesignerActionView[];
  readonly catalog: DesignFacetCatalog;
  /** ⚠ `denominator` 用服务端给的这一个，**不**用 `catalog` 里的项数去数 */
  readonly completeness: { readonly done: number; readonly denominator: number };
  readonly completedKeys: readonly string[];
  /** 完成度点击的落点；null ⇒ 没有未完成的必填项（今天恒 null，数据缺口 D-2） */
  readonly firstIncompleteRequiredKey: string | null;
  readonly autosave: DesignerAutosaveView;
  /** 已填项的真实内容 + 逐项并发令牌（`getBlueprintDesignFacets`）。 */
  readonly designFacets: readonly DesignerFacetRow[];
  /** 保存一项内容——真实调用 `updateDesignFacet`，由调用方（page-live）负责乐观并发与错误处理。 */
  readonly onSaveFacet: FacetSaveFn;
}

/**
 * 动作按钮名。⚠ 键来自服务端的 `action.id`，本表只提供**文案**；
 * 认不出的 id **显式渲染出来**而不是被 filter 掉——一个悄悄消失的按钮，
 * 在界面上与「后端没返回它」完全同形。
 */
const ACTION_LABEL: Record<string, string> = {
  "preview-participant-view": "预览参与者视图",
  "trial-run": "试跑一场",
  publish: "发布",
};

export function BlueprintDesignerShell({
  blueprintName,
  versionBar,
  actions,
  catalog,
  completeness,
  completedKeys,
  firstIncompleteRequiredKey,
  autosave,
  designFacets,
  onSaveFacet,
}: BlueprintDesignerShellProps) {
  const allItems = catalog.groups.flatMap((g) => g.items);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(
    allItems[0]?.designFacetKey ?? null,
  );
  const done = new Set(completedKeys);
  const facetByKey = new Map(designFacets.map((f) => [f.designFacetKey, f]));

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="bp-designer-shell">
      <header className="flex flex-col gap-1.5 border-b border-border px-4 py-3">
        <h1 className="text-16 font-semibold">{blueprintName} · 蓝本设计</h1>

        <p className="text-12 text-muted-foreground" data-testid="bp-designer-version-bar">
          {versionBar.publishedVersionNumber === null
            ? "草稿 · 尚未发布"
            : `v${versionBar.publishedVersionNumber} 已发布`}
          {" · "}
          {`用过 ${versionBar.appliedProjectCount} 次`}
          {" · "}
          <span className="text-background-foreground">
            {`改动生成 v${versionBar.nextVersionNumber}，已开过的项目锁在自己的版本上`}
          </span>
        </p>

        <AutosaveLine autosave={autosave} />

        <div className="flex flex-wrap items-center gap-2" data-testid="bp-designer-actions">
          {actions.map((action) => (
            <Button
              key={action.id}
              size="sm"
              variant={action.id === "publish" ? "primary" : "outline"}
              data-testid={`bp-designer-action-${action.id}`}
            >
              {ACTION_LABEL[action.id] ?? `未知动作（${action.id}）`}
              {action.versionNumber === null ? "" : ` v${action.versionNumber}`}
            </Button>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 w-full flex-col lg:flex-row">
        <nav
          className="flex w-full shrink-0 flex-col gap-1 border-b border-border p-3 lg:w-64 lg:border-b-0 lg:border-r"
          data-testid="bp-designer-facet-catalog"
        >
          <CompletenessRow
            completeness={completeness}
            firstIncompleteRequiredKey={firstIncompleteRequiredKey}
            onJump={setSelectedKey}
          />

          {allItems.length === 0 ? (
            <p className="rounded-md bg-panel px-2.5 py-2 text-12 text-muted-foreground" data-testid="empty">
              配置项定义表是空的 —— 设计器没有任何可填的格子。这不是「都填完了」。
            </p>
          ) : (
            catalog.groups.map((group) => (
              <div key={group.group} className="flex flex-col gap-0.5">
                <p
                  className="px-1 pt-2 text-11 text-muted-foreground"
                  data-testid={`bp-designer-group-${group.group}`}
                >
                  {group.label}
                </p>
                {group.items.length === 0 ? (
                  <p
                    className="px-1 text-11 text-muted-foreground"
                    data-testid={`bp-designer-group-empty-${group.group}`}
                  >
                    本组暂无配置项
                  </p>
                ) : (
                  group.items.map((item) => (
                    <button
                      key={item.designFacetKey}
                      type="button"
                      onClick={() => setSelectedKey(item.designFacetKey)}
                      aria-current={selectedKey === item.designFacetKey}
                      data-testid={`bp-designer-facet-${item.designFacetKey}`}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-12 transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selectedKey === item.designFacetKey
                          ? "bg-muted text-background-foreground"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      <span aria-hidden>{done.has(item.designFacetKey) ? "✓" : "○"}</span>
                      <span className="flex-1">{item.label}</span>
                      {item.required ? <span className="text-11 text-destructive">必填</span> : null}
                    </button>
                  ))
                )}
              </div>
            ))
          )}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="bp-designer-panel-slot">
          {selectedKey === null ? (
            <p className="text-12 text-muted-foreground">没有可打开的配置项。</p>
          ) : (
            <FacetPanel
              selectedKey={selectedKey}
              item={allItems.find((i) => i.designFacetKey === selectedKey) ?? null}
              facet={facetByKey.get(selectedKey) ?? null}
              onSaveFacet={onSaveFacet}
            />
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * 一个配置项打开后的真实面板（解开 D-05 二级 sign-off，`design-deltas/
 * blueprint-design-facet-panels/` 已签核）。
 *
 * ⚠ `content: string` 是今天已签核的存储形状（BP-02/F174），16 项目前统一走
 * `FacetTextEditor`（自由文本，写回同一个字符串字段）；「角色与权限」额外有
 * 人类已裁决的矩阵交互，用 `PermissionMatrixEditor`（把矩阵值 JSON 序列化后
 * 存进同一个字符串字段，不需要新的契约面）。`contract.md` 给出的其余 15 项
 * 结构化字段提议是后续把 `content` 升级为结构化存储时的参考，本增量暂不落地。
 */
function FacetPanel({
  selectedKey,
  item,
  facet,
  onSaveFacet,
}: {
  selectedKey: string;
  item: DesignFacetCatalog["groups"][number]["items"][number] | null;
  facet: DesignerFacetRow | null;
  onSaveFacet: FacetSaveFn;
}) {
  const content = facet?.content ?? "";
  // 哨兵 `''`：还没人填过这一项时，`expectedItemRevision` 传空串，同后端约定。
  const itemRevision = facet?.itemRevision ?? "";
  // key → 结构化编辑器组件 的唯一定义处是 facet-editor-registry.ts（I-5，本文件
  // 不再重复写 `selectedKey === "..."` 判断链——F202 复核发现原来的三元链撞上了
  // lint-design-facet-single-source 的「跨行第二份表」规则）。
  const Editor = getFacetEditor(selectedKey);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2" data-testid="bp-facet-panel-header">
        <h2 className="text-16 font-semibold">{item?.label ?? selectedKey}</h2>
        {item?.required ? <span className="text-11 text-destructive">必填</span> : null}
      </div>
      <Editor designFacetKey={selectedKey} content={content} itemRevision={itemRevision} onSave={onSaveFacet} />
    </div>
  );
}

/**
 * 自动保存行 —— V12 的界面一半。
 *
 * 失败分支**不含**「草稿自动保存」这几个字，这是刻意的：
 * 「已保存」与「上次保存于」在中文界面上差一个字，用户读到的却是相反的两件事。
 */
function AutosaveLine({ autosave }: { autosave: DesignerAutosaveView }) {
  if (autosave.status === "failed") {
    return (
      <p
        role="alert"
        className="rounded-md bg-panel px-2.5 py-1.5 text-11 text-destructive"
        data-testid="err-autosave"
      >
        {`自动保存失败（${autosave.failure ?? "未知原因"}）· 本次改动未保存`}
        {autosave.lastSavedAt === null ? " · 尚无成功保存" : ` · 上次成功保存 ${autosave.lastSavedAt}`}
        {" · 内容仍留在本页，可重试"}
      </p>
    );
  }
  return (
    <p className="text-11 text-muted-foreground" data-testid="bp-designer-autosave">
      {autosave.status === "saving"
        ? "正在保存草稿…"
        : autosave.lastSavedAt === null
          ? "草稿尚未保存过"
          : `草稿自动保存 · ${autosave.lastSavedAt}`}
    </p>
  );
}

/** 完成度 `n/分母`，可点击直达第一个未完成必填项（R8 推荐交互） */
function CompletenessRow({
  completeness,
  firstIncompleteRequiredKey,
  onJump,
}: {
  completeness: { readonly done: number; readonly denominator: number };
  firstIncompleteRequiredKey: string | null;
  onJump: (key: string) => void;
}) {
  const hasTarget = firstIncompleteRequiredKey !== null;
  return (
    <div className="flex flex-col gap-1 border-b border-border px-1 pb-2">
      <div className="flex items-center gap-2">
        <span className="text-12 font-medium">设计配置</span>
        <Button
          size="xs"
          variant="ghost"
          disabled={!hasTarget}
          onClick={() => firstIncompleteRequiredKey && onJump(firstIncompleteRequiredKey)}
          data-testid="bp-designer-completeness"
        >
          {`${completeness.done}/${completeness.denominator}`}
        </Button>
      </div>
      {hasTarget ? null : (
        <p className="px-1 text-11 text-muted-foreground" data-testid="bp-designer-completeness-no-target">
          无未完成的必填项可跳转（必填清单待人类给出，缺 D-2）
        </p>
      )}
    </div>
  );
}
