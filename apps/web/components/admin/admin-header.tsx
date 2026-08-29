"use client";
import * as React from "react";
import { Building2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useOptionalSession } from "@/components/session/session-provider";
import { ApiError } from "@/lib/api-client";
import { getTokenQuotas } from "@/lib/live-org-admin";
import { currentOrganizationLabel } from "@/lib/org-display";

/**
 * 后台顶部：组织标识 + 本月组织额度条（常驻在每个模块之上）。
 *
 * 之前这一整条是写死的 mock（`lib/mock/admin.ORG_HEADER`：组织名"远洋咨询"、
 * `org_8f21`、78%、4,820万/6,200万、还剩6天），且悬挂在每个后台屏顶部——包括
 * 已经标"真数据"的总览屏正上方，同屏假数据和真数据并置，是这批 mock 里
 * 误导性最强的一处（见组织总览审查）。现在改读真实数据源：
 *
 *   组织名/组织 ID   `useSession().identity.org`（登录时已解析，见 session-provider.tsx）
 *   本月额度/已用    `GET /organizations/:orgId/token-quotas`（`orgBudget`/`orgUsed`，
 *                    与"成员配额"tab 同一个真实端点，见 member-quota-tab.tsx）
 *
 * ⚠ `orgBudget` 可空——组织从未设置月度额度时 null ≠ 0，不画进度条，只说"未设置"
 *   （同 member-quota-tab.tsx 的纪律）。
 * ⚠ `daysLeft`（还剩几天）契约里没有周期结束时间字段——额度是"本自然月"额度，
 *   这里按本地日历现算，不是接口字段，也不是拍脑袋的写死数字。
 * ⚠ `getTokenQuotas` 仅组织 admin 可读（`FORBIDDEN`）——非 admin 打开后台时不崩，
 *   只在这一角显示"额度信息暂不可读"，不回退到任何写死数字掩盖失败。
 */

const fmt = new Intl.NumberFormat("zh-CN");

/** token 数按"万"缩写显示——与 member-quota-tab.tsx 的量级约定一致。 */
function fmtWan(n: number): string {
  return fmt.format(Math.round(n / 10_000));
}

/** 当前自然月还剩几天（含今天）。本地日历推算，不是后端字段。 */
function daysLeftInMonth(now: Date): number {
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate() + 1;
}

export function AdminHeader({ moduleLabel }: { moduleLabel: string }) {
  const session = useOptionalSession();
  const orgId = session?.session?.currentOrgId ?? null;
  const orgName = currentOrganizationLabel(session?.identity?.org.name);

  const [quota, setQuota] = React.useState<{ orgBudget: number | null; orgUsed: number } | null>(null);
  const [quotaError, setQuotaError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setQuota(null);
    setQuotaError(null);
    void (async () => {
      try {
        const out = await getTokenQuotas(orgId);
        if (!cancelled) setQuota({ orgBudget: out.orgBudget, orgUsed: out.orgUsed });
      } catch (err) {
        if (!cancelled) {
          setQuotaError(err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  const pct = quota?.orgBudget ? Math.min(100, Math.round((quota.orgUsed / quota.orgBudget) * 100)) : null;
  const tone = pct !== null && pct >= 90 ? "warning" : "primary";

  let quotaContent: React.ReactNode = null;
  if (orgId) {
    if (quotaError) {
      quotaContent = (
        <span className="text-11 text-muted-foreground" data-testid="admin-header-quota-error">
          额度信息暂不可读（{quotaError}）
        </span>
      );
    } else if (!quota) {
      quotaContent = <span className="text-11 text-muted-foreground">额度读取中…</span>;
    } else if (quota.orgBudget === null) {
      quotaContent = (
        <span className="text-11 text-muted-foreground" data-testid="admin-header-quota-unset">
          未设置组织月度额度
        </span>
      );
    } else {
      quotaContent = (
        <>
          <div className="flex items-baseline justify-between text-11">
            <span className="font-medium">本月组织额度 {pct}%</span>
            <span className="text-muted-foreground">还剩 {daysLeftInMonth(new Date())} 天</span>
          </div>
          <Progress
            value={pct ?? 0}
            tone={tone}
            label={`本月组织额度 ${pct}%`}
            className="w-full"
          />
          <span className="text-10 text-muted-foreground">
            {fmtWan(quota.orgUsed)} 万 / {fmtWan(quota.orgBudget)} 万 tokens
          </span>
        </>
      );
    }
  }

  return (
    <header data-testid="admin-header" className="flex flex-col gap-3 border-b border-border pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-inverse text-12 font-semibold text-inverse-foreground">
            <Building2 aria-hidden className="h-4 w-4" />
          </span>
          <div className="flex flex-col">
            <span className="text-14 font-semibold" data-testid="admin-header-org-name">{orgName}</span>
            {orgId && <span className="font-mono text-10 text-muted-foreground">组织 ID {orgId}</span>}
          </div>
          <Badge tone="outline" className="ml-1">{moduleLabel}</Badge>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-1 md:w-64" data-testid="admin-header-quota">
          {quotaContent}
        </div>
      </div>
    </header>
  );
}
