"use client";
import * as React from "react";
import { Building2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useOptionalSession } from "@/components/session/session-provider";
import { ApiError } from "@/lib/api-client";
import { getTokenQuotas } from "@/lib/live-org-admin";

/**
 * 后台顶部：组织标识 + 本月组织额度条（常驻在每个模块之上）。
 *
 * ## 为什么这里曾经是错的（去 mock）
 *
 * 之前整个头条读 `lib/mock/admin.ORG_HEADER`——一份写死的「远洋咨询 / org_8f21 / 78%」。
 * 因为它挂在共用骨架 `AdminScreen` 里，**每一个**后台子页（总览/成员配额/反馈/我的本地……）
 * 都会渲染出同一组假数字，与页面本身是否已经接了真后端无关。人类看真实后台截图时点出的
 * 「这些都是错的」，指的正是这一层——不是某个具体子页。
 *
 * 现在：组织名/ID 取自已登录身份（`identity.org`，`resolveIdentity` 的真实字段，见
 * `session-provider.tsx`）；额度条取自 `getTokenQuotas`（F160，`GET
 * /organizations/:orgId/token-quotas`，与「成员配额」tab 同一个真实端点）。
 *
 * ## 未设置组织额度 ≠ 0%
 *
 * `orgBudget` 为 null 时不画进度条、不编一个百分比——那正是 `member-quota-tab.tsx`
 * 已经立过的规矩（null ≠ 0），这里只是把同一条规矩用在头条上。
 */

const fmt = new Intl.NumberFormat("zh-CN");

/** 当前自然月还剩几天（含今天）——纯日历计算，不是接口字段。 */
function daysLeftInMonth(now: Date): number {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return end - now.getDate() + 1;
}

type QuotaState =
  | { kind: "no-org" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unset" }
  | { kind: "ready"; used: number; budget: number };

export function AdminHeader({ moduleLabel }: { moduleLabel: string }) {
  const session = useOptionalSession();
  const orgId = session?.session?.currentOrgId ?? null;
  const orgName = session?.identity?.org.name ?? null;

  const [quota, setQuota] = React.useState<QuotaState>({ kind: "no-org" });

  /**
   * ⚠ 独立审查发现（PR #2425）：这里此前是 `if (!orgId) return;` **在**清空/重置状态之前——
   * 切组织（或组织变 null）时，`quota` 还停在上一个组织的额度数字上，直到新请求成功才刷新；
   * 请求失败时甚至永远不刷新。等于在新组织的身份下短暂/持续显示旧组织的用量数据。
   *
   * 现在：`orgId` 一变，**先同步清空**（不管新值是不是 null），再决定要不要发新请求——
   * 界面永远不会拿一个不属于当前 `orgId` 的额度渲染出来，哪怕只有一帧。
   */
  React.useEffect(() => {
    if (!orgId) { setQuota({ kind: "no-org" }); return; }
    let cancelled = false;
    setQuota({ kind: "loading" });
    void (async () => {
      try {
        const out = await getTokenQuotas(orgId);
        if (cancelled) return;
        setQuota(
          out.orgBudget === null
            ? { kind: "unset" }
            : { kind: "ready", used: out.orgUsed, budget: out.orgBudget },
        );
      } catch (err) {
        if (!cancelled) {
          setQuota({
            kind: "error",
            message: err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err),
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  const pct = quota.kind === "ready" && quota.budget > 0
    ? Math.min(100, Math.round((quota.used / quota.budget) * 100))
    : quota.kind === "ready" ? 0 : null;
  const tone = pct !== null && pct >= 90 ? "warning" : "primary";

  return (
    <header data-testid="admin-header" className="flex flex-col gap-3 border-b border-border pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-inverse text-12 font-semibold text-inverse-foreground">
            <Building2 aria-hidden className="h-4 w-4" />
          </span>
          <div className="flex flex-col">
            <span className="text-14 font-semibold" data-testid="admin-header-org-name">
              {orgName ?? "…"}
            </span>
            <span className="font-mono text-10 text-muted-foreground" data-testid="admin-header-org-id">
              组织 ID {orgId ?? "—"}
            </span>
          </div>
          <Badge tone="outline" className="ml-1">{moduleLabel}</Badge>
        </div>

        <div className="flex w-full max-w-xs flex-col gap-1 md:w-64" data-testid="admin-header-quota">
          {quota.kind === "no-org" && (
            <span className="text-11 text-muted-foreground" data-testid="admin-header-quota-no-org">
              尚未选择组织
            </span>
          )}
          {quota.kind === "loading" && (
            <span className="text-11 text-muted-foreground">额度读取中…</span>
          )}
          {quota.kind === "error" && (
            <span className="text-11 text-destructive" data-testid="admin-header-quota-error">
              额度读取失败（{quota.message}）
            </span>
          )}
          {quota.kind === "unset" && (
            <span className="text-11 text-muted-foreground" data-testid="admin-header-quota-unset">
              组织本月额度未设置
            </span>
          )}
          {quota.kind === "ready" && pct !== null && (
            <>
              <div className="flex items-baseline justify-between text-11">
                <span className="font-medium">本月组织额度 {pct}%</span>
                <span className="text-muted-foreground">还剩 {daysLeftInMonth(new Date())} 天</span>
              </div>
              <Progress value={pct} tone={tone} label={`本月组织额度 ${pct}%`} className="w-full" />
              <span className="text-10 text-muted-foreground">
                {fmt.format(quota.used)} / {fmt.format(quota.budget)} tokens
              </span>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
