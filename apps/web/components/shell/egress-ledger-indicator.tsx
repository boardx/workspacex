"use client";

/**
 * 零出网指示 —— 本地版标识条上那一格「本次启动出网 N 次」（backlog E4）。
 *
 * ## 这一格不许是写死的标签
 *
 * 它读 `GET /identity/local-org/egress-ledger`：API 进程在 `net.Socket.prototype.connect`
 * 这一个咽喉上数到的非回环连接（`local-egress-guard.ts`）。显示哪一格只由契约的
 * `egressLedgerState` 判，文案只来自 `EGRESS_LEDGER_STATE_LABEL`——界面不自己比计数、不自己编句子。
 *
 * ## 读不到 ≠ 0
 *
 * 请求失败时显示「读不到出网记录」，**绝不**兜成「出网 0 次」。一个把失败画成绿色的零出网
 * 指示，正是 E4 要消灭的那种「声明像权威」。
 */
import * as React from "react";
import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import {
  EGRESS_LEDGER_STATE_LABEL, egressLedgerState, type EgressLedgerState,
} from "@repo/contracts/deployment";
import { getEgressLedger, type GetEgressLedgerOut } from "@/lib/live-identity";
import { cn } from "@/lib/utils";

/** 多久重读一次。出网是会随时发生的事，一次性读取的数字过一会儿就成了痕迹。 */
export const EGRESS_LEDGER_POLL_MS = 15_000;

const KIND_LABEL: Record<GetEgressLedgerOut["recent"][number]["kind"], string> = {
  onRequest: "你要求的",
  refused: "已挡住",
  export: "确认导出",
  unexpected: "意外",
};

const TONE: Record<EgressLedgerState, string> = {
  zero: "text-success",
  "on-request": "",
  blocked: "text-warning",
  unexpected: "text-destructive",
};

type Loaded = { status: "loading" } | { status: "error" } | { status: "ok"; ledger: GetEgressLedgerOut };

export function EgressLedgerIndicator(
  { load = getEgressLedger, pollMs = EGRESS_LEDGER_POLL_MS }:
  { load?: () => Promise<GetEgressLedgerOut>; pollMs?: number },
): React.ReactElement {
  const [state, setState] = React.useState<Loaded>({ status: "loading" });
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const read = () => {
      load().then(
        (ledger) => { if (!cancelled) setState({ status: "ok", ledger }); },
        () => { if (!cancelled) setState({ status: "error" }); },
      );
    };
    read();
    const t = setInterval(read, pollMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [load, pollMs]);

  if (state.status !== "ok") {
    return (
      <span data-testid="egress-ledger" data-state={state.status} className="flex items-center gap-1 text-11 opacity-80">
        <ShieldQuestion aria-hidden className="h-3.5 w-3.5 shrink-0" />
        {state.status === "loading" ? "正在读取出网记录" : "读不到出网记录"}
      </span>
    );
  }

  const { counts, recent } = state.ledger;
  const verdict = egressLedgerState(counts);
  const Icon = verdict === "zero" || verdict === "on-request" ? ShieldCheck : ShieldAlert;
  const total = counts.onRequest + counts.refused + counts.export + counts.unexpected;
  return (
    <span className="relative flex items-center">
      <button
        type="button"
        data-testid="egress-ledger"
        data-state={verdict}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1 rounded-control px-1.5 py-0.5 text-11 font-medium transition-colors hover:bg-ai-tint-foreground/10",
          TONE[verdict],
        )}
      >
        <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span data-testid="egress-ledger-label">{EGRESS_LEDGER_STATE_LABEL[verdict]}</span>
        {verdict !== "zero" && (
          <span data-testid="egress-ledger-counts" className="opacity-80">
            （你要求的 {counts.onRequest} · 已挡住 {counts.refused} · 导出 {counts.export} · 意外 {counts.unexpected}）
          </span>
        )}
      </button>
      {open && (
        <span
          data-testid="egress-ledger-detail"
          className="absolute left-0 top-full z-20 mt-1 flex w-72 flex-col gap-0.5 rounded-control border border-border bg-popover p-2 text-11 text-popover-foreground shadow-md"
        >
          <span className="opacity-80">
            自 {new Date(state.ledger.since).toLocaleString()} 本次启动以来，本机 API 进程共 {total} 次非本机连接。
          </span>
          {recent.length === 0 ? (
            <span data-testid="egress-ledger-empty">没有任何连接离开过这台电脑。</span>
          ) : (
            <ul data-testid="egress-ledger-recent">
              {recent.slice().reverse().map((r, i) => (
                <li key={`${r.at}-${i}`} className="flex gap-1 py-0.5">
                  <span className="font-medium">{KIND_LABEL[r.kind]}</span>
                  <span className="truncate">{r.target}</span>
                </li>
              ))}
            </ul>
          )}
        </span>
      )}
    </span>
  );
}
