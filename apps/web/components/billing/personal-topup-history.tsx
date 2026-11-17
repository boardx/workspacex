"use client";

import { useState } from "react";
import { billingCredits } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { usePersonalPricingRead } from "./personal-pricing-read";

const endpoint = billingCredits.operations.listTransactions;
const parse = (raw: unknown) => endpoint.out.parse(raw);
const firstPage = { ownerType: "user", type: "purchase", limit: "10" };

export function PersonalTopupHistory({ userId, sessionToken }: { userId: string; sessionToken: string }) {
  const { locale } = useI18n();
  const english = locale === "en";
  const [query, setQuery] = useState<Record<string, string>>(firstPage);
  const { state, retry } = usePersonalPricingRead(endpoint.path, parse, userId, sessionToken, query);
  const title = english ? "Recharge history" : "充值记录";
  const formatDate = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return <section aria-label={title} className="space-y-3 rounded-card border border-border p-5">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-14 font-medium">{title}</h2>
      <Button size="sm" variant="ghost" onClick={() => { setQuery(firstPage); retry(); }}>
        {english ? "Refresh recharge history" : "刷新充值记录"}
      </Button>
    </div>
    {state.status === "loading" && <p role="status">{english ? "Loading…" : "正在查询…"}</p>}
    {(state.status === "error" || state.status === "ready" && state.refreshError) &&
      <p role="status">{english ? "Could not load recharge history. Please refresh." : "暂时无法查询充值记录，请刷新重试。"}</p>}
    {state.status === "ready" && <>
      {state.data.items.length === 0 ? <p className="text-12 text-muted-foreground">
        {english ? "No credited recharges yet." : "暂无已到账的充值记录。"}
      </p> : <ul className="divide-y divide-border">
        {state.data.items.map(row => <li key={row.txnId} className="flex flex-wrap justify-between gap-2 py-3 text-13">
          <div>
            <time dateTime={row.createdAt}>{formatDate.format(new Date(row.createdAt))}</time>
            <p className="break-all text-12 text-muted-foreground">{english ? "Order" : "订单号"} {row.sourceId}</p>
          </div>
          <span>+{row.credits.toLocaleString(locale)} Credits</span>
        </li>)}
      </ul>}
      <div className="flex justify-end gap-2">
        {query.cursor && <Button size="sm" variant="ghost" onClick={() => setQuery(firstPage)}>
          {english ? "Latest" : "返回最新"}
        </Button>}
        {state.data.nextCursor && state.data.nextCursor !== query.cursor && <Button size="sm" variant="ghost"
          onClick={() => setQuery({ ...firstPage, cursor: state.data.nextCursor! })}>
          {english ? "Older records" : "查看更早记录"}
        </Button>}
      </div>
    </>}
  </section>;
}
