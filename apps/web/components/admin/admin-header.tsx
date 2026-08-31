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
 *
 * ## 为什么额度用一个 `key={orgId}` 的子组件，而不是在 effect 里清空 state（PR #2425 二轮独立审查）
 *
 * 第一版修法是「`orgId` 一变，effect 里同步 `setQuota(...)` 清空」。独立审查指出这在时序上
 * 仍然太晚：React 对 `orgId` 变化先渲染并**提交**一次（这一帧里组件已经用新组织的身份，
 * 但 `quota` state 还是上一个组织的旧值，因为 state 更新要等**下一个**渲染），
 * `useEffect` 是被动效果，提交之后才跑，再触发的 `setQuota` 已经是第二次渲染了——
 * 旧组织的额度数字因此可能被真实提交到 DOM 一帧，只是这一帧被测试的 `act()` 自动
 * flush 掉了看不见，不代表真实浏览器里不会画出来。
 *
 * 真正堵死这个缺口要让「数据属于哪个组织」成为**渲染时**的不变量，不能靠事后清空。
 * 这里用的办法是 React 的标准解法：把持有额度 state 的部分拆成 `AdminHeaderQuota`，
 * 用 `key={orgId}` 挂载——`orgId` 一变，React 直接把旧的组件实例连同它的全部 state
 * 一起丢弃、换一个全新实例（初始 state 直接由新 `orgId` 算出，例如没有 orgId 就是
 * `no-org`），这个替换发生在**同一次协调 / 同一次提交**里，不存在「新身份 + 旧数据」
 * 能被提交到屏幕上的中间态。`useEffect` 依然用来发起真正的网络请求，但不再承担
 * 「清空谁属于谁」这件事——那件事现在由 `key` 保证，是结构性的，不是时序上的巧合。
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

        {/* `key={orgId}` 是这里的重点：见上方文件头注「为什么用 key 而不是 effect 清空」。 */}
        <AdminHeaderQuota key={orgId ?? "__no_org__"} orgId={orgId} />
      </div>
    </header>
  );
}

/**
 * 只持有「这一个 orgId 的额度」——`orgId` 变化时整个组件实例被 `key` 换掉重新挂载，
 * 因此它的初始 state 永远精确对应挂载时的 `orgId`，不会有「用别的 orgId 算出来的
 * state」被这个实例渲染出来的可能。
 */
function AdminHeaderQuota({ orgId }: { orgId: string | null }) {
  const [quota, setQuota] = React.useState<QuotaState>(() => (orgId ? { kind: "loading" } : { kind: "no-org" }));

  React.useEffect(() => {
    if (!orgId) return; // 初始 state 已经是 no-org（见上），这里没有请求要发。
    let cancelled = false;
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
  );
}
