"use client";
import * as React from "react";
import { Star } from "lucide-react";
import { firstValueEvents as FV } from "@repo/contracts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api-client";
import { describeFailure } from "@/lib/design-failure";
import { getOrgFirstValueFunnel, type OrgFirstValueFunnel } from "@/lib/live-first-value";
import { useI18n } from "@/lib/i18n/provider";
import { translate, type MessageKey } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

/**
 * issue #4248 —— 组织总览里的「第一个价值时刻」漏斗（本组织，真数据）。
 *
 * 端点只返回**本组织**每步的首次时刻（契约 `OrgFirstValueFunnelOut`），不是多组织计数——
 * 所以每步显示「是否到达 + 距首次登录几分钟」，没有跨组织转化率可算；编一个百分比出来
 * 反而会被读成「组织里多少人走到了这一步」。价值时刻那一步取自契约 `FIRST_VALUE_STEP`，
 * 预算取自响应里的 `budgetMinutes`（契约字面量 15），本文件不再声明第二份。
 */
const FIRST_VALUE_STEP_KEY = {
  first_sign_in: "adminOverview.step.first_sign_in",
  workspace_opened: "adminOverview.step.workspace_opened",
  cited_answer_sample: "adminOverview.step.cited_answer_sample",
  own_material_uploaded: "adminOverview.step.own_material_uploaded",
  question_on_own_material: "adminOverview.step.question_on_own_material",
  cited_answer_own_material: "adminOverview.step.cited_answer_own_material",
  citation_opened: "adminOverview.step.citation_opened",
} as const satisfies Record<FV.FirstValueStepValue, MessageKey>;

export const FIRST_VALUE_STEP_LABEL: Record<FV.FirstValueStepValue, string> = Object.fromEntries(
  (Object.keys(FIRST_VALUE_STEP_KEY) as FV.FirstValueStepValue[]).map((step) => [step, translate("zh-CN", FIRST_VALUE_STEP_KEY[step])]),
) as Record<FV.FirstValueStepValue, string>;

export function FirstValueFunnelPanel() {
  const { t, locale } = useI18n();
  const fmtMin = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const [data, setData] = React.useState<OrgFirstValueFunnel | null>(null);
  const [error, setError] = React.useState<{ cause: unknown } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const out = await getOrgFirstValueFunnel();
        if (!cancelled) setData(out);
      } catch (err) {
        if (cancelled) return;
        setError({ cause: err });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const start = data?.steps.find((s) => s.step === "first_sign_in")?.occurredAt ?? null;
  const empty = data !== null && data.steps.every((s) => s.occurredAt === null);
  const minutes = data?.minutesToFirstValue ?? null;
  const overBudget = data !== null && minutes !== null && minutes > data.budgetMinutes;

  return (
    <section className="flex flex-col gap-2" data-testid="admin-first-value-funnel">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-14 font-semibold">{t("adminOverview.firstValue")}</h2>
        <span className="text-11 text-muted-foreground">
          {t("adminOverview.firstValueHint")}
        </span>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          {error && (
            <p className="text-12 text-muted-foreground" data-testid="admin-first-value-load-failed">
              {error.cause instanceof ApiError && error.cause.reasonCode === "NOT_ORG_ADMIN"
                ? t("adminOverview.firstValueDenied")
                : t("adminOverview.firstValueFailure", { error: describeFailure(error.cause, locale) })}
            </p>
          )}
          {!data && !error && <p className="text-12 text-muted-foreground">{t("ui.loading")}</p>}
          {empty && (
            <p className="text-12 text-muted-foreground" data-testid="admin-first-value-empty">
              {t("adminOverview.firstValueEmpty")}
            </p>
          )}
          {data && !empty && (
            <>
              <div className="flex flex-wrap items-center gap-2" data-testid="admin-first-value-budget">
                <span className="text-12">{t("adminOverview.firstValueTiming")}</span>
                {minutes === null ? (
                  <Badge tone="neutral" data-testid="admin-first-value-not-reached">{t("adminOverview.notReachedYet")}</Badge>
                ) : (
                  <>
                    <span className="text-14 font-semibold" data-testid="admin-first-value-minutes">
                      {t("adminOverview.minutes", { minutes: fmtMin.format(minutes) })}
                    </span>
                    <Badge tone={overBudget ? "danger" : "success"} data-testid="admin-first-value-verdict">
                      {overBudget ? t("adminOverview.overBudget") : t("adminOverview.withinBudget")}
                    </Badge>
                  </>
                )}
                <span className="text-11 text-muted-foreground">{t("adminOverview.budget", { minutes: new Intl.NumberFormat(locale).format(data.budgetMinutes) })}</span>
              </div>
              <ol className="flex flex-col gap-1">
                {data.steps.map((s, i) => {
                  const isValue = s.step === FV.FIRST_VALUE_STEP;
                  const since =
                    s.occurredAt && start ? (Date.parse(s.occurredAt) - Date.parse(start)) / 60_000 : null;
                  return (
                    <li
                      key={s.step}
                      data-testid={`admin-first-value-step-${s.step}`}
                      data-value-moment={isValue ? "true" : undefined}
                      className={cn(
                        "flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5",
                        isValue && "border border-primary bg-accent",
                      )}
                    >
                      <span className="w-5 font-mono text-11 text-muted-foreground">{i + 1}</span>
                      <span className={cn("text-12", isValue && "font-semibold")}>{t(FIRST_VALUE_STEP_KEY[s.step])}</span>
                      {isValue && (
                        <Badge tone="primary" data-testid="admin-first-value-moment-badge">
                          <Star aria-hidden className="mr-1 h-3 w-3" />
                          {t("adminOverview.valueMoment")}
                        </Badge>
                      )}
                      <span className="ml-auto text-11 text-muted-foreground">
                        {s.occurredAt === null
                          ? t("adminOverview.notReached")
                          : since !== null && since >= 0
                            ? t("adminOverview.reachedAt", { minutes: fmtMin.format(since) })
                            : t("adminOverview.reached")}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
