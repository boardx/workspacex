"use client";
import * as React from "react";
import type { z } from "zod";
import { billingCredits as billing } from "@repo/contracts";
import { apiRequest, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import type { CashierOwner } from "./use-cashier-order";
type Page = z.infer<typeof billing.operations.listTransactions.out>;
export function CashierLedgerHistory({ owner, sessionToken, initial, onDenied }: { owner: CashierOwner; sessionToken: string; initial: Page; onDenied: () => void }) {
  const [expanded, expand] = React.useState(false);
  const [items, setItems] = React.useState(initial.items);
  const [cursor, setCursor] = React.useState(initial.nextCursor);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const pending = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => { pending.current?.abort(); }, []);
  async function loadMore() {
    if (!cursor || pending.current) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setFailed(false);
    try {
      const raw = await apiRequest<unknown>(billing.operations.listTransactions.path, { sessionToken, signal: controller.signal, query: { ownerType: owner.ownerType, ...(owner.ownerType === "team" ? { ownerId: owner.ownerId } : {}), cursor, limit: "20" } });
      const page = billing.operations.listTransactions.out.parse(raw);
      if (page.nextCursor === cursor) throw new Error("LEDGER_CURSOR_DID_NOT_ADVANCE");
      if (!controller.signal.aborted) {
        setItems(previous => { const known = new Set(previous.map(item => item.txnId)); return [...previous, ...page.items.filter(item => { if (known.has(item.txnId)) return false; known.add(item.txnId); return true; })]; });
        setCursor(page.nextCursor);
      }
    } catch (error) {
      if (!controller.signal.aborted) { setFailed(true); if (error instanceof ApiError && [401, 403].includes(error.status)) onDenied(); }
    } finally { if (!controller.signal.aborted) setBusy(false); if (pending.current === controller) pending.current = null; }
  }
  return <div className="space-y-3">
    {items.length === 0 ? <p data-testid="billing-ledger-empty" className="py-6 text-center text-13 text-muted-foreground">暂无流水</p> : <table data-testid="billing-ledger-table" className="w-full text-left text-13 tabular-nums"><caption className="sr-only">额度流水</caption><thead className="text-muted-foreground"><tr><th scope="col" className="pb-3 font-medium">类型</th><th scope="col" className="pb-3 font-medium">变动</th><th scope="col" className="pb-3 text-right font-medium">余额</th></tr></thead><tbody className="divide-y divide-border">{(expanded ? items : initial.items).map(item => <tr key={item.txnId}><td className="py-3">{item.type === "consume" ? "模型消费" : item.type === "purchase" ? "充值" : item.type === "bonus" ? "赠送" : "发放"}</td><td className="py-3">{item.direction === 1 ? "+" : "−"}{item.credits}</td><td className="py-3 text-right">{item.balanceAfter}</td></tr>)}</tbody></table>}
    {!expanded && cursor && <Button data-testid="billing-view-all-ledger" variant="outline" onClick={() => { expand(true); void loadMore(); }}>查看全部流水</Button>}
    {expanded && cursor && <Button variant="outline" disabled={busy} onClick={() => { void loadMore(); }}>{busy ? "正在查询…" : failed ? "重试加载流水" : "加载更多流水"}</Button>}
    {failed && <p role="status" className="text-13 text-muted-foreground">较早流水暂时无法查询，已显示的记录仍保留。</p>}
  </div>;
}
