"use client";
import * as React from "react";
import { Gauge, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { AdminModal, Field, Toast } from "./panel";
import { useOptionalSession } from "@/components/session/session-provider";
import { ApiError } from "@/lib/api-client";
import {
  getTokenQuotas, setMemberTokenQuota, setOrgTokenBudget, type GetTokenQuotasOut,
} from "@/lib/live-org-admin";
import { ORG_ROLE_LABEL, type OrgRole } from "@/lib/identity";

/**
 * F160 —— 「成员配额」tab 的**真栈**实现（token-quota-and-usage delta）。
 *
 * ## 这块屏之前为什么是假的
 *
 * 数字来自 `lib/mock/admin.MEMBERS`（`usedM` / `limitM` 两个写死的浮点数）。根因不在
 * 前端：全仓此前**零 token 计量落库**（F159 的迁移才建起 `token_usage_events`）。
 * 所以本文件不是「把 mock 换成 fetch」，是它上游第一次有了可读的事实。
 *
 * ## null ≠ 0，全文件贯彻
 *
 * `orgBudget` / `unallocated` / `monthlyLimit` 三个字段都可空，null 一律渲染成
 * 「未设置 / 未分配」而**不是 0**：把「还没人设过组织额度」显示成 `0/0` 会让每个新组织
 * 看起来像已经用尽——`seat_quota` 默认 0 那次生产事故（迁移 `20260811040000` 的头注）
 * 就是这么发生的。所以这里没有任何一个 `?? 0`。
 */

/** 与后端 `OVERSPEND_WARNING_RATIO` 同义，但**不参与判定**——超支人数由服务端算好下发
 *  （`overspendCount`），这里只用它写清楚那句提示里的百分比。 */
const OVERSPEND_LABEL = "85%";

/** token 数按「万 / 百万」缩写显示：原型上是「5,400 万 / 4.0M」这类量级。 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(0)} 万`;
  return n.toLocaleString();
}

function quotaTone(pct: number): "primary" | "warning" | "destructive" {
  if (pct >= 95) return "destructive";
  if (pct >= 80) return "warning";
  return "primary";
}

type Row = GetTokenQuotasOut["members"][number];

export function MemberQuotaTab() {
  // ⚠ 用 `useOptionalSession`：本组件挂在 `/admin/members` 这块屏里，而那块屏的既有
  // 测试是脱离 SessionProvider 直接渲染的。硬要 provider 会让「没有会话」变成一个
  // 崩溃而不是一个状态——而「还没选组织」本来就是个正常状态。
  const session = useOptionalSession()?.session ?? null;
  const orgId = session?.currentOrgId ?? null;

  const [data, setData] = React.useState<GetTokenQuotasOut | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [budgetOpen, setBudgetOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!orgId) return;
    setLoadError(null);
    try {
      setData(await getTokenQuotas(orgId));
    } catch (err) {
      // 失败就说失败，不退回 mock 数字——一屏看起来正常但数字是假的，比一条错误消息危险得多。
      setLoadError(err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err));
    }
  }, [orgId]);

  React.useEffect(() => { void load(); }, [load]);

  const saveMemberQuota = async () => {
    if (!orgId || !editing) return;
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0) { setSaveError("请输入一个非负整数"); return; }
    setSaveError(null);
    try {
      await setMemberTokenQuota(orgId, editing.userId, Math.trunc(parsed));
      setEditing(null);
      setToast(`已把 ${editing.displayName} 的月度额度设为 ${fmtTokens(Math.trunc(parsed))} token`);
      await load();
    } catch (err) {
      // ⚠ 把「还剩多少可分」原样说出来：只说「超了」等于让管理员靠试
      //   （O-29⑤：阻断必须伴随可执行的下一步）。
      const detail = err instanceof ApiError ? (err.raw as { remainingTokens?: number } | null) : null;
      const code = err instanceof ApiError ? err.reasonCode : null;
      setSaveError(
        code === "QUOTA_OVERALLOCATED" && typeof detail?.remainingTokens === "number"
          ? `超出组织剩余额度：现在最多还能分配 ${fmtTokens(detail.remainingTokens)} token`
          : code ?? String(err),
      );
    }
  };

  const saveOrgBudget = async () => {
    if (!orgId) return;
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0) { setSaveError("请输入一个非负整数"); return; }
    setSaveError(null);
    try {
      await setOrgTokenBudget(orgId, Math.trunc(parsed));
      setBudgetOpen(false);
      setToast(`组织月度额度已设为 ${fmtTokens(Math.trunc(parsed))} token`);
      await load();
    } catch (err) {
      const detail = err instanceof ApiError ? (err.raw as { allocated?: number } | null) : null;
      const code = err instanceof ApiError ? err.reasonCode : null;
      setSaveError(
        code === "BUDGET_BELOW_ALLOCATED" && typeof detail?.allocated === "number"
          ? `不能低于已分配之和（${fmtTokens(detail.allocated)} token）。先调低某些人的额度，再降组织额度。`
          : code ?? String(err),
      );
    }
  };

  if (!orgId) return <p className="p-3 text-12 text-muted-foreground">尚未选择组织。</p>;
  if (loadError) {
    return (
      <Card data-testid="admin-quota-load-failed">
        <CardContent className="flex flex-wrap items-center gap-2 p-3 text-12">
          <span className="text-destructive">配额数据读取失败：{loadError}</span>
          <Button size="xs" variant="outline" onClick={() => void load()}>重试</Button>
        </CardContent>
      </Card>
    );
  }
  if (!data) return <p className="p-3 text-12 text-muted-foreground">正在读取配额…</p>;

  const budgetUnset = data.orgBudget === null;

  return (
    <div className="flex flex-col gap-5" data-testid="admin-quota-live">
      {/* ── 三张卡 ───────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card data-testid="admin-quota-card-allocated">
          <CardContent className="flex flex-col gap-1 pt-4">
            <span className="text-11 text-muted-foreground">已分配配额</span>
            <span className="text-20 font-semibold">{fmtTokens(data.allocated)}</span>
            <span className="text-11 text-muted-foreground">
              {budgetUnset
                ? "组织额度未设置"
                : `占组织额度 ${data.orgBudget === 0 ? 0 : Math.round((data.allocated / data.orgBudget!) * 100)}%`}
            </span>
          </CardContent>
        </Card>
        <Card data-testid="admin-quota-card-unallocated">
          <CardContent className="flex flex-col gap-1 pt-4">
            <span className="text-11 text-muted-foreground">未分配</span>
            {/* ⚠ 这里是本屏最重要的一处 null：未设置组织额度时显示「—」，不是 0。 */}
            <span className="text-20 font-semibold">
              {data.unallocated === null ? "—" : fmtTokens(data.unallocated)}
            </span>
            <span className="text-11 text-muted-foreground">
              {budgetUnset ? "未设置组织额度 ⇒ 当前不限额、不阻断" : "建议留作应急池"}
            </span>
          </CardContent>
        </Card>
        <Card data-testid="admin-quota-card-overspend">
          <CardContent className="flex flex-col gap-1 pt-4">
            <span className="text-11 text-muted-foreground">超支预警</span>
            <span className="text-20 font-semibold text-warning">{data.overspendCount} 人</span>
            <span className="text-11 text-muted-foreground">已用 ≥ {OVERSPEND_LABEL}</span>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-11 text-muted-foreground" data-testid="admin-quota-org-budget">
          组织本月额度：{budgetUnset ? "未设置" : fmtTokens(data.orgBudget!)} · 本月已用 {fmtTokens(data.orgUsed)}
        </span>
        <Button
          size="xs"
          variant="outline"
          className="ml-auto"
          data-testid="admin-quota-budget-open"
          onClick={() => { setDraft(data.orgBudget === null ? "" : String(data.orgBudget)); setSaveError(null); setBudgetOpen(true); }}
        >
          {budgetUnset ? "设置组织额度" : "调整组织额度"}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => void load()} data-testid="admin-quota-refresh">
          <RefreshCw aria-hidden className="h-3.5 w-3.5" />
          刷新
        </Button>
      </div>

      {/* ── 成员行 ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2" data-testid="admin-quota-members">
        <div className="flex items-center gap-1.5">
          <Gauge aria-hidden className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-14 font-semibold">成员配额</h2>
          <span className="text-11 text-muted-foreground">· 共 {data.members.length} 人</span>
        </div>
        <Card>
          <CardContent className="flex flex-col pt-2">
            {data.members.length === 0 && (
              <p className="py-3 text-12 text-muted-foreground">组织里还没有成员。</p>
            )}
            {data.members.map((m, i) => {
              // 未分配额度的人**没有百分比**——没有分母就没有比例。画一条 0% 的进度条
              // 会让「没分配」和「分了但没用」看起来一模一样。
              const pct = m.monthlyLimit === null || m.monthlyLimit === 0
                ? null
                : Math.round((m.usedTokens / m.monthlyLimit) * 100);
              return (
                <div key={m.userId} data-testid={`admin-member-row-${m.userId}`}>
                  <div className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="w-16 shrink-0 text-13 font-medium">{m.displayName}</span>
                    <Badge tone="outline">{ORG_ROLE_LABEL[m.orgRole as OrgRole] ?? m.orgRole}</Badge>
                    <span className="text-11 text-muted-foreground">{m.email}</span>
                    <div className="ml-auto flex w-full items-center gap-3 sm:w-64">
                      {pct === null ? (
                        <span className="flex-1 text-11 text-muted-foreground">未分配额度</span>
                      ) : (
                        <Progress
                          value={Math.min(100, pct)}
                          tone={quotaTone(pct)}
                          label={`${m.displayName} 配额 ${pct}%`}
                          className="flex-1"
                        />
                      )}
                      <span
                        className="shrink-0 font-mono text-11 text-muted-foreground"
                        data-testid={`admin-member-quota-usage-${m.userId}`}
                      >
                        {fmtTokens(m.usedTokens)}/{m.monthlyLimit === null ? "—" : fmtTokens(m.monthlyLimit)}
                      </span>
                    </div>
                    <Button
                      size="xs"
                      variant="outline"
                      data-testid={`admin-member-quota-${m.userId}`}
                      onClick={() => {
                        setEditing(m);
                        setDraft(m.monthlyLimit === null ? "" : String(m.monthlyLimit));
                        setSaveError(null);
                      }}
                    >
                      调整
                    </Button>
                  </div>
                  {i < data.members.length - 1 && <Separator />}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>

      {editing && (
        <AdminModal
          title={`调整 ${editing.displayName} 的月度额度`}
          testid="admin-member-quota-modal"
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)} data-testid="admin-member-quota-cancel">取消</Button>
              <Button size="sm" variant="primary" onClick={() => void saveMemberQuota()} data-testid="admin-member-quota-save">保存</Button>
            </>
          }
        >
          <Field
            id="admin-member-quota-input"
            label="月度额度（token）"
            value={draft}
            inputMode="numeric"
            onChange={(e) => setDraft(e.target.value)}
            data-testid="admin-member-quota-input"
          />
          <p className="text-11 text-muted-foreground">
            本月已用 {fmtTokens(editing.usedTokens)} token。
            {data.unallocated === null
              ? "组织额度未设置，当前不限额。"
              : `组织未分配余量 ${fmtTokens(data.unallocated)} token。`}
          </p>
          {saveError && (
            <p className="text-11 text-destructive" data-testid="admin-member-quota-error">{saveError}</p>
          )}
        </AdminModal>
      )}

      {budgetOpen && (
        <AdminModal
          title="组织月度 token 额度"
          testid="admin-quota-budget-modal"
          onClose={() => setBudgetOpen(false)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setBudgetOpen(false)}>取消</Button>
              <Button size="sm" variant="primary" onClick={() => void saveOrgBudget()} data-testid="admin-quota-budget-save">保存</Button>
            </>
          }
        >
          <Field
            id="admin-quota-budget-input"
            label="组织月度额度（token）"
            value={draft}
            inputMode="numeric"
            onChange={(e) => setDraft(e.target.value)}
            data-testid="admin-quota-budget-input"
          />
          <p className="text-11 text-muted-foreground">
            已分配 {fmtTokens(data.allocated)} token。调到低于这个数会被拒绝——
            「谁被砍」由你决定，服务端不会替你截断任何人的额度。
          </p>
          {saveError && (
            <p className="text-11 text-destructive" data-testid="admin-quota-budget-error">{saveError}</p>
          )}
        </AdminModal>
      )}

      <Toast message={toast} testid="admin-quota-toast" onDismiss={() => setToast(null)} />
    </div>
  );
}
