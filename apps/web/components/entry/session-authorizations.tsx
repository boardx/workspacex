"use client";
import * as React from "react";
import { Check, IdCard } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { Badge } from "@/components/ui/badge";
import { SESSION } from "@/lib/mock/entry";

/**
 * 「我授权了什么」——把同意书上的逐项授权**只读回显**，每项旁边一个「改」（即时生效 + 回执）。
 *
 * 回执怎么表达（裁决 D-U10 要求「改动即时生效并给回执」）：
 *  · 切换即刻改变该项的当前状态与说明文字（乐观，不需要「保存」按钮）；
 *  · 该项下方立即出现一行 `role="status"` 的回执：带 ✓、说明改成了什么、一个回执号 + 时间。
 *    回执号让受访者（与读屏器）确信「这次改动被系统接住并记下了」，不是点了个没反应的开关。
 * ⚠ 拒绝实名引用时显示会用什么代称（realname 关闭 → 常驻「代称」badge + 回执文案点名代称）。
 */
export function SessionAuthorizations() {
  const [granted, setGranted] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(SESSION.grants.map((g) => [g.id, g.granted])),
  );
  // 回执：id → { seq, at, text }。每改一次自增回执号。
  const [receipts, setReceipts] = React.useState<Record<string, { seq: number; at: string; text: string }>>({});
  const seqRef = React.useRef(0);

  const change = (id: string, next: boolean) => {
    const g = SESSION.grants.find((x) => x.id === id)!;
    setGranted((s) => ({ ...s, [id]: next }));
    seqRef.current += 1;
    setReceipts((r) => ({
      ...r,
      [id]: {
        seq: seqRef.current,
        at: SESSION.elapsed,
        text: next
          ? `已授权「${g.label}」，即时生效`
          : g.id === "realname"
            ? `已撤销实名引用，报告中改用代称「${SESSION.alias}」，即时生效`
            : `已撤销「${g.label}」，即时生效`,
      },
    }));
  };

  return (
    <section className="flex flex-col gap-2" data-testid="session-authorizations">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-14 font-semibold">我授权了什么</h2>
        <p className="text-11 text-muted-foreground">
          下面是你在同意书里的选择。改动即时生效，会给你一条回执——你随时可以改回来。
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {SESSION.grants.map((g) => {
          const on = !!granted[g.id];
          const r = receipts[g.id];
          const isRealnameOff = g.id === "realname" && !on;
          return (
            <li
              key={g.id}
              data-testid={`session-grant-${g.id}`}
              className="flex flex-col gap-2 rounded-md border border-border-subtle bg-panel p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-13 font-medium">{g.label}</span>
                    <Badge
                      tone={on ? "primary" : "neutral"}
                      data-testid={`session-grant-state-${g.id}`}
                    >
                      {on ? "已授权" : "未授权"}
                    </Badge>
                    {isRealnameOff && (
                      <Badge tone="outline" data-testid="session-grant-alias">
                        <IdCard aria-hidden className="h-3 w-3" /> 代称「{SESSION.alias}」
                      </Badge>
                    )}
                  </div>
                  <p className="text-11 text-muted-foreground">{on ? g.onDesc : g.offDesc}</p>
                </div>
                <label className="flex shrink-0 items-center gap-1.5">
                  <span className="text-11 text-muted-foreground">改</span>
                  <Toggle
                    checked={on}
                    onCheckedChange={(v) => change(g.id, v)}
                    label={`改：${g.label}`}
                    data-testid={`session-grant-toggle-${g.id}`}
                  />
                </label>
              </div>

              {r && (
                <p
                  role="status"
                  data-testid={`session-grant-receipt-${g.id}`}
                  className="inline-flex items-center gap-1.5 rounded-sm bg-muted px-2 py-1 text-11 text-success"
                >
                  <Check aria-hidden className="h-3 w-3" />
                  {r.text} · 回执 #R-{r.seq} · {r.at}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
