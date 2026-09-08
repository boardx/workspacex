"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { ApiError } from "@/lib/api-client";
import {
  listStandingToolGrants, revokeStandingToolGrant, type StandingToolGrantsOut,
} from "@/lib/live-org-admin";

/**
 * 「长期工具授权」区块（issue #3068）——挂在 `/org-admin/profile`（组织资料）下方。
 *
 * ## 它修的是什么
 *
 * 用户在审批卡片上点「以后都允许」，服务端写下一条组织级、跨 run、无过期的授权，此后
 * 同组织所有同类调用被自动放行。而在本区块之前，**仓里没有任何界面能看见或收回它**——
 * 卡片文案却写着「可在下次弹出时改选拒绝以撤销」，可那个弹层再也不会出现。
 * 一次点击 = 永久且不可达。这里是那句文案现在指向的真实入口。
 *
 * ## 为什么在「组织资料」而不是新开一个左栏入口
 *
 * 授权面是整个组织，和组织资料同一层身份（都是组织配置、都是组织 admin 面），所以复用
 * 这一屏、不新增导航项：新增一项要同时改 `AdminModuleKey` / `ADMIN_NAV_COUNT_SOURCES` /
 * `nav-reachability.config.json` 与几处枚举了全部屏的测试，改动面比它解决的问题大。
 *
 * ## 空态是有意义的，不是"没做"
 *
 * 一个从没点过「以后都允许」的组织在这里看到的空清单，正是"当前没有任何长期授权在生效"
 * 这条事实本身——它与"这个功能不存在"是两件事，所以有独立文案，不是隐藏区块。
 */
export function StandingToolGrantsSection(): JSX.Element {
  const [state, setState] = React.useState<UiState>("loading");
  const [rows, setRows] = React.useState<StandingToolGrantsOut>([]);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setState("loading");
    try {
      setRows(await listStandingToolGrants());
      setState("default");
    } catch (cause) {
      // 非 admin 打开这一屏看到的是真实的 403 → "无权限"，不是被隐藏的空白。
      setState(cause instanceof ApiError && cause.status === 403 ? "denied" : "dep-failed");
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const revoke = async (grantId: string) => {
    if (busyId) return;
    setBusyId(grantId);
    setError(null);
    try {
      await revokeStandingToolGrant(grantId);
      // 撤销后重新拉清单，而不是本地删一行：另一位管理员可能同时撤了别的行，
      // 本地推断出来的清单会和服务端不一致——而这一屏的全部价值就是"能看见真的还剩什么"。
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 404
        ? "这条授权已经不存在了（可能已被另一位管理员撤销）。"
        : "撤销失败，请重试。");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="flex flex-col gap-3" data-testid="standing-tool-grants">
      <div className="flex items-center gap-2">
        <ShieldCheck aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-14 font-semibold">长期工具授权</h2>
      </div>
      <p className="text-12 text-muted-foreground">
        成员在审批卡片上选择「以后都允许」后，该工具在本组织内不再逐次询问。撤销后，
        下一次同类操作会重新弹出审批。
      </p>
      <StateShell
        state={state}
        denial={{ layer: "organization", reason: "只有组织管理员可以查看和撤销长期工具授权。" }}
        depFailure={{ what: "长期工具授权列表", retry: () => void load() }}
      >
        {rows.length === 0 ? (
          <p data-testid="standing-tool-grants-empty" className="text-12 text-muted-foreground">
            本组织当前没有任何长期工具授权。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.grantId}
                data-testid="standing-tool-grant-row"
                className="flex items-center justify-between gap-3 rounded-control border border-border p-3"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-13 font-medium">{row.toolName}</span>
                  <span className="text-11 text-muted-foreground">
                    {row.grantedByUserId ? `由 ${row.grantedByUserId} 批准` : "批准人未记录"}
                    {` · ${new Date(row.grantedAt).toLocaleString()}`}
                  </span>
                </div>
                <Button
                  variant="destructive"
                  data-testid="standing-tool-grant-revoke"
                  disabled={busyId !== null}
                  onClick={() => void revoke(row.grantId)}
                >
                  {busyId === row.grantId ? "撤销中…" : "撤销"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error ? <p role="alert" className="text-12 text-danger">{error}</p> : null}
      </StateShell>
    </section>
  );
}
