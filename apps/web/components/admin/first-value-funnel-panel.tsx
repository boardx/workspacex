"use client";
import * as React from "react";
import { Star } from "lucide-react";
import { firstValueEvents as FV } from "@repo/contracts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api-client";
import { describeFailure } from "@/lib/design-failure";
import { getOrgFirstValueFunnel, type OrgFirstValueFunnel } from "@/lib/live-first-value";
import { cn } from "@/lib/utils";

/**
 * issue #4248 —— 组织总览里的「第一个价值时刻」漏斗（本组织，真数据）。
 *
 * 端点只返回**本组织**每步的首次时刻（契约 `OrgFirstValueFunnelOut`），不是多组织计数——
 * 所以每步显示「是否到达 + 距首次登录几分钟」，没有跨组织转化率可算；编一个百分比出来
 * 反而会被读成「组织里多少人走到了这一步」。价值时刻那一步取自契约 `FIRST_VALUE_STEP`，
 * 预算取自响应里的 `budgetMinutes`（契约字面量 15），本文件不再声明第二份。
 */
export const FIRST_VALUE_STEP_LABEL: Record<FV.FirstValueStepValue, string> = {
  first_sign_in: "首次登录",
  workspace_opened: "进入工作区",
  cited_answer_sample: "示例项目拿到带引用的回答",
  own_material_uploaded: "上传自己的材料",
  question_on_own_material: "基于自己的材料提问",
  cited_answer_own_material: "回答引用了自己的材料",
  citation_opened: "点开引用查看原件",
};

const fmtMin = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

export function FirstValueFunnelPanel() {
  const [data, setData] = React.useState<OrgFirstValueFunnel | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const out = await getOrgFirstValueFunnel();
        if (!cancelled) setData(out);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError && err.reasonCode === "NOT_ORG_ADMIN"
          ? "仅组织管理员可查看价值时刻漏斗。"
          : `读不到价值时刻漏斗：${describeFailure(err)}`);
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
        <h2 className="text-14 font-semibold">第一个价值时刻</h2>
        <Badge tone="outline">真数据</Badge>
        <span className="text-11 text-muted-foreground">
          从本组织首次登录起，到智能体回答第一次引用你们自己上传的材料。数据只留在本实例。
        </span>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          {error && (
            <p className="text-12 text-muted-foreground" data-testid="admin-first-value-load-failed">
              {error}
            </p>
          )}
          {!data && !error && <p className="text-12 text-muted-foreground">加载中…</p>}
          {empty && (
            <p className="text-12 text-muted-foreground" data-testid="admin-first-value-empty">
              本组织还没有任何漏斗记录——成员首次登录后这里开始计时。
            </p>
          )}
          {data && !empty && (
            <>
              <div className="flex flex-wrap items-center gap-2" data-testid="admin-first-value-budget">
                <span className="text-12">首次登录 → 价值时刻：</span>
                {minutes === null ? (
                  <Badge tone="neutral" data-testid="admin-first-value-not-reached">尚未到达</Badge>
                ) : (
                  <>
                    <span className="text-14 font-semibold" data-testid="admin-first-value-minutes">
                      {fmtMin.format(minutes)} 分钟
                    </span>
                    <Badge tone={overBudget ? "danger" : "success"} data-testid="admin-first-value-verdict">
                      {overBudget ? "超出预算" : "预算内"}
                    </Badge>
                  </>
                )}
                <span className="text-11 text-muted-foreground">预算 {data.budgetMinutes} 分钟</span>
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
                      <span className={cn("text-12", isValue && "font-semibold")}>{FIRST_VALUE_STEP_LABEL[s.step]}</span>
                      {isValue && (
                        <Badge tone="primary" data-testid="admin-first-value-moment-badge">
                          <Star aria-hidden className="mr-1 h-3 w-3" />
                          价值时刻
                        </Badge>
                      )}
                      <span className="ml-auto text-11 text-muted-foreground">
                        {s.occurredAt === null
                          ? "未到达"
                          : since !== null && since >= 0
                            ? `已到达 · 第 ${fmtMin.format(since)} 分钟`
                            : "已到达"}
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
