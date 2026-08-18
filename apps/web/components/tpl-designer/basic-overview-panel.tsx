"use client";
import * as React from "react";
import type { z } from "zod";
import type { templates } from "@repo/contracts";

type DurationTier = z.infer<typeof templates.operations.setDurationTier.in>["tier"];
import type { GetInitializationPreviewOut, SetDurationTierOut } from "@/lib/live-blueprints";

/**
 * 第 16 项「基本配置」聚合页 —— 蓝本设计器目录 16 项里唯一**不是 designFacetKey** 的一项。
 *
 * 其余 15 项各自对应一个 `design_facet` 行（走 `updateDesignFacet` 的
 * `content: string`）；这一项聚合的是**蓝本本体上的字段**（时长档位）与**服务端派生的
 * 只读视图**（套用后会初始化什么），因此它不走 facet 读写，而是直接调
 * `setDurationTier` / `getInitializationPreview` 两个已签核契约操作。
 *
 * ⚠ 逐项对照 `apps/web/components/tpl/designer-panels.tsx` 的 `BasicOverviewPanel`。
 * 原型有五节，本组件如实收窄到**真实有后端的两节**，其余三节不做假 UI：
 * - ✅ 时长档位 —— 真实 `setDurationTier`（预检 → 确认两步，见下）
 * - ✅ 套用后会初始化什么（六类恒定）—— 真实 `getInitializationPreview`
 * - ⛔ 形式与语言 —— 蓝本本体上没有这两个字段，契约里也没有对应操作；
 *      「形式」已在第 9 项「场地与形式」facet 里真实可配（F205），不在这里重复造
 *      第二个入口（同一事实不得声明在两处）；「语言」今天没有任何存储落点，
 *      造一个存不进去的选择器就是假 UI。
 * - ⛔ 模型策略三车道 / 配额与降级 —— 组织层设置（token 配额与模型池是 org 级的，
 *      见 F159/F160/F161），不是蓝本字段；原型把它们画在这里是示意，真接线要走
 *      组织设置的既有屏，不在蓝本设计器里再开一个写入口。
 *
 * ## 换档是两步，不是一步
 *
 * `setDurationTier` 的 `confirmed: false` 是**预检**：后端回 `CONFIRMATION_REQUIRED`
 * 并附上将被增删的环节；用户看清后再 `confirmed: true` 落库。前端不得跳过预检直接
 * 提交——那等于替用户拍板删环节。被移除的可选环节是 `recoverable`（切回该档可恢复），
 * 这一点在确认弹层里如实写出来，否则用户会以为环节被永久删掉。
 */

const TIERS: readonly { readonly tier: DurationTier; readonly label: string; readonly note: string }[] = [
  { tier: "half-day", label: "半天", note: "只到收敛，不做原型" },
  { tier: "one-day", label: "一天", note: "加商业模式草稿" },
  { tier: "two-day", label: "两天", note: "加原型与用户测试" },
  { tier: "three-day", label: "三天", note: "加迭代与落地计划" },
  { tier: "custom", label: "自定义", note: "规则未定义——后端会明确拒绝，不猜推导式" },
];

const TIER_INTRO =
  "决定这个蓝本能被套用到什么场合。时长档位最关键——同一套骨架按档位伸缩：可选环节自动增删，必留环节只压缩时间。";

const HALF_SESSION_NOTE =
  "档位以半场（半天）为单位。一个半场约 3–3.5 小时、3–4 个环节，这是人能保持专注的上限；跨半场的休息与交接是流程的一部分，不是空隙——多天项目的成败通常取决于「隔夜之后怎么接上」。";

const INIT_FOOTNOTE =
  "写入的是默认值。引导师在那一场里改，不会回写蓝本；要沉淀就在复盘里「提交回蓝本」。";

/** 六类恒定——空类也要出现，否则「这次没有分组」与「我们不初始化分组」不可分辨。 */
const INIT_CATEGORIES = ["议程环节", "分组", "角色分工", "材料清单", "会前任务", "画布与产出物"] as const;

export type SetTierFn = (tier: DurationTier, confirmed: boolean) => Promise<SetDurationTierOut>;

export interface BasicOverviewPanelProps {
  readonly currentTier: DurationTier;
  readonly agendaSegmentCount: number;
  readonly preview: GetInitializationPreviewOut | null;
  readonly previewError: string | null;
  readonly onSetTier: SetTierFn;
}

interface PendingChange {
  readonly tier: DurationTier;
  readonly added: SetDurationTierOut["added"];
  readonly removed: SetDurationTierOut["removed"];
  readonly recoverable: SetDurationTierOut["recoverable"];
}

export function BasicOverviewPanel({
  currentTier,
  agendaSegmentCount,
  preview,
  previewError,
  onSetTier,
}: BasicOverviewPanelProps) {
  const [pending, setPending] = React.useState<PendingChange | null>(null);
  const [status, setStatus] = React.useState<"idle" | "checking" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  function describeError(e: unknown): string {
    const reasonCode = (e as { reasonCode?: unknown } | null)?.reasonCode;
    if (reasonCode === "VERSION_CHANGED") return "这个蓝本已被别处改动，档位未切换——请刷新页面后重试";
    if (reasonCode === "CUSTOM_TIER_RULE_UNDEFINED") {
      return "「自定义」档的伸缩规则尚未定义，后端拒绝了这次切换（不会猜一个推导式）";
    }
    if (typeof reasonCode === "string" && reasonCode.length > 0) return `切换失败（${reasonCode}）`;
    if (e instanceof Error) return e.message;
    return "切换失败，请重试";
  }

  /** 第一步：预检。不落库，只把将被增删的环节拿回来给人看。 */
  async function precheck(tier: DurationTier): Promise<void> {
    if (tier === currentTier) return;
    setStatus("checking");
    setError(null);
    try {
      const out = await onSetTier(tier, false);
      // 后端未要求确认（无环节变动）时直接落库。
      setPending({ tier, added: out.added, removed: out.removed, recoverable: out.recoverable });
    } catch (e) {
      const reasonCode = (e as { reasonCode?: unknown } | null)?.reasonCode;
      if (reasonCode === "CONFIRMATION_REQUIRED") {
        // ⚠ 失败信封的完整 body 挂在 `ApiError.raw` 上（`api-client.ts` 只把
        //    `reasonCode` 提到顶层）——预检要展示的增删清单在 `raw.detail` 里，
        //    不是 `e.detail`。这一条是被测试逼出来的：第一版读 `e.detail`，
        //    界面上「移除 2 个」显示成「移除 0 个」，人会以为切档不删环节。
        const raw = (e as { raw?: { detail?: Partial<SetDurationTierOut> } } | null)?.raw;
        const d = raw?.detail;
        setPending({
          tier,
          added: d?.added ?? [],
          removed: d?.removed ?? [],
          recoverable: d?.recoverable ?? [],
        });
        setStatus("idle");
        return;
      }
      setStatus("error");
      setError(describeError(e));
    }
  }

  /** 第二步：确认落库。 */
  async function confirm(): Promise<void> {
    if (pending === null) return;
    setStatus("saving");
    setError(null);
    try {
      await onSetTier(pending.tier, true);
      setPending(null);
      setStatus("saved");
    } catch (e) {
      setStatus("error");
      setError(describeError(e));
    }
  }

  return (
    <div data-testid="bp-basic-overview">
      <p className="mb-3 text-11 text-muted-foreground">
        {TIER_INTRO}
        {status !== "idle" && (
          <span className={status === "error" ? "ml-2 text-destructive" : "ml-2"} data-testid="bp-basic-status">
            {status === "checking"
              ? "预检中…"
              : status === "saving"
                ? "保存中…"
                : status === "saved"
                  ? "已保存"
                  : "切换失败"}
          </span>
        )}
      </p>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-basic-tier">
        <h3 className="mb-2 text-13 font-semibold">时长档位（套用时先选档，环节表随之变化）</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {TIERS.map((t) => (
            <button
              key={t.tier}
              type="button"
              onClick={() => void precheck(t.tier)}
              aria-current={t.tier === currentTier}
              className={
                t.tier === currentTier
                  ? "flex flex-col items-start gap-0.5 rounded-md border border-primary bg-accent px-3 py-2 text-left transition-colors"
                  : "flex flex-col items-start gap-0.5 rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-muted"
              }
              data-testid={`bp-basic-tier-${t.tier}`}
            >
              <span className="text-12 font-medium">
                {t.label}
                {t.tier === currentTier ? "（当前）" : ""}
              </span>
              <span className="text-10 text-muted-foreground">{t.note}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-11" data-testid="bp-basic-agenda-count">
          当前档位 → 议程环节 <b>{agendaSegmentCount}</b> 个
        </p>
        <p className="mt-2 text-11 leading-relaxed text-muted-foreground">{HALF_SESSION_NOTE}</p>

        {pending !== null && (
          <div className="mt-3 rounded-md border border-warning/40 bg-warning/5 p-2.5" data-testid="bp-basic-confirm">
            <p className="text-12 font-medium">切到「{TIERS.find((t) => t.tier === pending.tier)?.label}」会改动议程环节：</p>
            <ul className="mt-1 flex flex-col gap-0.5 text-11 text-muted-foreground">
              <li data-testid="bp-basic-added">新增 {pending.added.length} 个环节</li>
              <li data-testid="bp-basic-removed">移除 {pending.removed.length} 个可选环节</li>
              {pending.recoverable.length > 0 && (
                <li data-testid="bp-basic-recoverable">
                  其中 {pending.recoverable.length} 个是可恢复的——切回该档位它们会回来，不是永久删除
                </li>
              )}
            </ul>
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                onClick={() => void confirm()}
                className="rounded-md border border-primary px-2 py-1 text-11 text-primary transition-colors hover:bg-muted"
                data-testid="bp-basic-confirm-yes"
              >
                确认切换
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
                data-testid="bp-basic-confirm-no"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {error !== null && (
          <p role="alert" className="mt-2 text-11 text-destructive" data-testid="bp-basic-error">
            {error}
          </p>
        )}
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-basic-init-preview">
        <h3 className="mb-2 text-13 font-semibold">套用后会初始化什么（六类 · 服务端派生）</h3>
        {previewError !== null ? (
          <p role="alert" className="text-11 text-destructive" data-testid="bp-basic-preview-error">
            {previewError}
          </p>
        ) : preview === null ? (
          <p className="text-11 text-muted-foreground" data-testid="bp-basic-preview-loading">
            读取中…
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {INIT_CATEGORIES.map((c) => {
              const items = preview.items.filter((i) => i.category === c);
              return (
                <li key={c} className="flex flex-col gap-0.5 p-2.5" data-testid={`bp-basic-init-category-${c}`}>
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-border px-1.5 py-0.5 text-11 font-medium">{c}</span>
                    <span className="text-10 text-muted-foreground">{items.length} 项</span>
                  </div>
                  {items.length === 0 ? (
                    // 空类也要出现——「这次没有分组」与「我们不初始化分组」必须可分辨。
                    <p className="text-11 text-muted-foreground" data-testid={`bp-basic-init-empty-${c}`}>
                      这一类这次不会初始化任何东西（对应的配置项还没填）
                    </p>
                  ) : (
                    <p className="text-11 text-muted-foreground">{items.map((i) => i.label).join("、")}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 rounded-md bg-panel px-2.5 py-1.5 text-11 text-muted-foreground" data-testid="bp-basic-init-footnote">
          {INIT_FOOTNOTE}
        </p>
      </div>
    </div>
  );
}
