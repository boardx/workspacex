"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AGENDA_TIER_CATALOG, type AgendaTierKey } from "@/lib/generated/agenda-tier-catalog";

/**
 * 「时长档位 · 形式 · 语言」表单（F19 / `uc-2-1` R3 步骤 1–2）。
 *
 * ## 它为什么不在 `components/tpl/`
 *
 * 同 `blueprint-designer-shell.tsx`（F18）：`components/tpl/` 是原型屏，
 * 已被 `lint-design-facet-single-source.mjs` 列为已知 DEBT，新写的真实实现放在
 * `components/tpl-designer/` 之外让门控对它零容忍。
 *
 * ## 它是一个投影，不是数据源
 *
 * 四档的议程环节数来自 `@/lib/generated/agenda-tier-catalog`——机械生成自
 * `apps/api/src/domain/templates/agenda-segment-table.ts`，本文件里没有 7/11/14/19
 * 这几个数字的第二份硬编码。当前生效的 `agendaSegmentCount`（含「全线上」自动追加的
 * 两个）由服务端算好通过 props 传入，不由本组件用档位表反推。
 *
 * ## 换档位确认框（G-3 缺口：F19 待补画的界面）
 *
 * 契约 `setDurationTier` 的注释：「换档位是破坏性变更（R8），`confirmed:false` ⇒
 * `TIER_CHANGE_NEEDS_CONFIRMATION` + 将被增删的议程环节清单」。`pendingTierChange`
 * 非空时渲染确认框，逐项列出将增删的环节；`recoverable` 的语义（「切回该档位可恢复」）
 * 用一句提示呈现在移除清单下面，不做成需要用户理解的技术术语。
 *
 * ## 「全线上」的自动增删（A2 / I-16 / V5）
 *
 * 选「全线上」时，`onlineAutoSegments` 由调用方传入当前生效的两个自动环节
 * （破冰 / 举手排队），并标明来源；切回其它形式时它们消失，不需要用户手动删除。
 */

export interface DurationFormAgendaSegmentView {
  readonly agendaSegmentId: string;
  readonly title: string;
}

export interface PendingTierChange {
  readonly targetTier: AgendaTierKey;
  readonly added: readonly DurationFormAgendaSegmentView[];
  readonly removed: readonly DurationFormAgendaSegmentView[];
}

export type SessionFormatView = "hybrid" | "onsite" | "online";
export type SessionLanguageView = "zh" | "en" | "bilingual";

export interface BlueprintDurationFormProps {
  readonly durationTier: AgendaTierKey;
  /** ⚠ 服务端给的总数（含「全线上」自动追加的两个），前端不用档位表反推 */
  readonly agendaSegmentCount: number;
  /**
   * ⚠ 可选：蓝本本体今天**没有**「形式」「语言」这两个字段，契约里也没有对应的写操作。
   * 第 16 项「基本配置」聚合页因此只复用本组件的时长档位一节，不传这两个——
   * 传了就是造一个存不进去的选择器（假 UI）。F19 的既有用法照旧传，两节照常渲染。
   * 「形式」真正可配的地方是第 9 项 `venue-and-format` facet（F205），不在这里开第二个入口。
   */
  readonly format?: SessionFormatView;
  readonly language?: SessionLanguageView;
  /** 非 null ⇒ 有一次换档位正在等待确认（因为会移除内容） */
  readonly pendingTierChange: PendingTierChange | null;
  /** 「全线上」形式下当前生效的自动追加环节；非「全线上」时应为空数组 */
  readonly onlineAutoSegments: readonly DurationFormAgendaSegmentView[];
  readonly onSelectTier: (tier: AgendaTierKey) => void;
  readonly onConfirmTierChange: () => void;
  readonly onCancelTierChange: () => void;
  readonly onSelectFormat?: (format: SessionFormatView) => void;
  readonly onSelectLanguage?: (language: SessionLanguageView) => void;
}

const TIER_LABEL: Record<AgendaTierKey, string> = {
  "half-day": "半天",
  "one-day": "一天",
  "two-day": "两天（默认）",
  "three-day": "三天",
};

const FORMAT_LABEL: Record<SessionFormatView, string> = {
  hybrid: "混合",
  onsite: "线下",
  online: "全线上",
};

const LANGUAGE_LABEL: Record<SessionLanguageView, string> = {
  zh: "中文",
  en: "English",
  bilingual: "双语现场",
};

export function BlueprintDurationForm({
  durationTier,
  agendaSegmentCount,
  format,
  language,
  pendingTierChange,
  onlineAutoSegments,
  onSelectTier,
  onConfirmTierChange,
  onCancelTierChange,
  onSelectFormat,
  onSelectLanguage,
}: BlueprintDurationFormProps) {
  return (
    <section className="flex flex-col gap-4" data-testid="bp-duration-form">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-14 font-medium">时长档位</h2>
          <span className="text-12 text-muted-foreground" data-testid="bp-duration-agenda-count">
            {`${agendaSegmentCount} 环节`}
          </span>
        </div>

        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="时长档位">
          {AGENDA_TIER_CATALOG.map((row) => (
            <Button
              key={row.tier}
              type="button"
              size="sm"
              variant={row.tier === durationTier ? "primary" : "outline"}
              aria-pressed={row.tier === durationTier}
              onClick={() => onSelectTier(row.tier)}
              data-testid={`bp-duration-tier-${row.tier}`}
            >
              {`${TIER_LABEL[row.tier]} · ${row.agendaSegmentCount} 环节`}
            </Button>
          ))}
        </div>

        <p className="text-11 text-muted-foreground" data-testid="bp-duration-tier-rule">
          可选环节自动增删，必留环节只压缩时间。
        </p>

        {pendingTierChange ? (
          <div
            role="alertdialog"
            aria-label="确认换档位"
            className="flex flex-col gap-2 rounded-md border border-border bg-panel p-3"
            data-testid="bp-duration-tier-confirm"
          >
            <p className="text-12 font-medium">
              {`切到「${TIER_LABEL[pendingTierChange.targetTier]}」会移除 ${pendingTierChange.removed.length} 个议程环节`}
            </p>

            {pendingTierChange.added.length > 0 ? (
              <div data-testid="bp-duration-tier-confirm-added">
                <p className="text-11 text-muted-foreground">将新增：</p>
                <ul className="list-disc pl-4 text-11">
                  {pendingTierChange.added.map((seg) => (
                    <li key={seg.agendaSegmentId} data-testid={`bp-duration-tier-confirm-added-${seg.agendaSegmentId}`}>
                      {seg.title}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {pendingTierChange.removed.length > 0 ? (
              <div data-testid="bp-duration-tier-confirm-removed">
                <p className="text-11 text-muted-foreground">将移除（切回该档位可恢复）：</p>
                <ul className="list-disc pl-4 text-11">
                  {pendingTierChange.removed.map((seg) => (
                    <li
                      key={seg.agendaSegmentId}
                      data-testid={`bp-duration-tier-confirm-removed-${seg.agendaSegmentId}`}
                    >
                      {seg.title}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={onConfirmTierChange}
                data-testid="bp-duration-tier-confirm-confirm"
              >
                确认切换
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onCancelTierChange}
                data-testid="bp-duration-tier-confirm-cancel"
              >
                取消
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {format === undefined || onSelectFormat === undefined ? null : (
      <div className="flex flex-col gap-2">
        <h2 className="text-14 font-medium">形式</h2>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="形式">
          {(Object.keys(FORMAT_LABEL) as SessionFormatView[]).map((f) => (
            <Button
              key={f}
              type="button"
              size="sm"
              variant={f === format ? "primary" : "outline"}
              aria-pressed={f === format}
              onClick={() => onSelectFormat(f)}
              data-testid={`bp-format-${f}`}
            >
              {FORMAT_LABEL[f]}
            </Button>
          ))}
        </div>
        <p className="text-11 text-muted-foreground" data-testid="bp-format-online-note">
          混合＝线下分组＋远程组员用手机进组；选「全线上」会自动加「破冰」和「举手排队」两个议程环节。
        </p>

        {format === "online" ? (
          <div
            className="flex flex-col gap-1 rounded-md bg-panel px-2.5 py-2"
            data-testid="bp-online-auto-segments"
          >
            {onlineAutoSegments.length === 0 ? (
              <p className="text-11 text-muted-foreground" data-testid="bp-online-auto-segments-empty">
                「全线上」自动追加的环节尚未生效。
              </p>
            ) : (
              onlineAutoSegments.map((seg) => (
                <p
                  key={seg.agendaSegmentId}
                  className="flex items-center gap-1.5 text-11"
                  data-testid={`bp-online-auto-segment-${seg.agendaSegmentId}`}
                >
                  <span>{seg.title}</span>
                  <span className="text-10 text-muted-foreground">来源：形式设置（切回可移除）</span>
                </p>
              ))
            )}
          </div>
        ) : null}
      </div>
      )}

      {language === undefined || onSelectLanguage === undefined ? null : (
      <div className="flex flex-col gap-2">
        <h2 className="text-14 font-medium">语言</h2>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="语言">
          {(Object.keys(LANGUAGE_LABEL) as SessionLanguageView[]).map((l) => (
            <Button
              key={l}
              type="button"
              size="sm"
              variant={l === language ? "primary" : "outline"}
              aria-pressed={l === language}
              onClick={() => onSelectLanguage(l)}
              data-testid={`bp-language-${l}`}
            >
              {LANGUAGE_LABEL[l]}
            </Button>
          ))}
        </div>
        <p className={cn("text-11 text-muted-foreground")} data-testid="bp-language-note">
          语言影响产出物与报告模板的生成语言。
        </p>
      </div>
      )}
    </section>
  );
}
