"use client";
import * as React from "react";
import Link from "next/link";
import { CornerDownRight, MessageSquare, Quote, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { chatMemoryHref } from "@/lib/chat-memory-link";
import {
  fetchSessionBriefing, recordSessionBriefingEvent, setSessionBriefingDismissed, type BriefingItem, type SessionBriefing as Briefing,
} from "@/lib/knowledge-graph-api";
import { briefingCitationText, briefingKindLabel, briefingOriginLabel, briefingSections } from "@/lib/session-briefing-view";

/** 简报读取的上限：超过就不等了（这次不显示），输入框从头到尾都不受它影响。 */
export const SESSION_BRIEFING_TIMEOUT_MS = 8000;

type State =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly briefing: Briefing }
  | { readonly status: "failed" };

/**
 * issue #4362 —— 新个人对话空状态里的开场简报：「上次在做的事 / 没做完的待办 / 还没定下来的」。
 *
 *   - 服务端生成（`getSessionBriefing`），只基于本人个人空间；没有可说的 ⇒ 整块不出现（不占位、不打扰）；
 *   - 每条「续上」：把服务端写好的首问填进输入框（不发送），并在这里留一行「引用：〈类型〉原文」——预填的问题依据的是哪一条记忆；
 *     发出去之后，回答下方的引用 chip 指回的也是这一条（首问逐字引用原文）；
 *   - 「关闭」：偏好记在服务端（换个设备也不再出现），/brain「关于我」里可以重新打开；
 *   - 埋点：展示（有内容时一次）/ 采纳（续上）/ 关闭，供北极星指标用；埋点失败不影响界面；
 *   - 不阻塞输入框：独立取数、有超时；读不到只留一行说明。
 */
export function SessionBriefing({ onResume }: { onResume: (prompt: string) => void }) {
  const [state, setState] = React.useState<State>({ status: "loading" });
  const [hidden, setHidden] = React.useState(false);
  const [cited, setCited] = React.useState<BriefingItem | null>(null);
  const [dismissError, setDismissError] = React.useState(false);
  const shownRef = React.useRef(false);

  React.useEffect(() => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), SESSION_BRIEFING_TIMEOUT_MS);
    fetchSessionBriefing(ctl.signal).then(
      (briefing) => { if (!ctl.signal.aborted) setState({ status: "ready", briefing }); },
      () => { setState({ status: "failed" }); },
    ).finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); ctl.abort(); };
  }, []);

  const items = React.useMemo(
    () => (state.status === "ready" && !state.briefing.dismissed ? state.briefing.items : []),
    [state],
  );
  React.useEffect(() => {
    if (items.length === 0 || shownRef.current) return;
    shownRef.current = true;
    void recordSessionBriefingEvent("shown", items.map((i) => i.itemId)).catch(() => undefined);
  }, [items]);

  if (state.status === "loading") {
    return (
      <div className="flex w-full max-w-lg animate-pulse flex-col gap-2" data-testid="session-briefing-loading" aria-hidden>
        <div className="h-4 w-1/3 rounded-md bg-muted" />
        <div className="h-10 rounded-md bg-muted" />
      </div>
    );
  }
  if (state.status === "failed") {
    return (
      <p role="status" className="text-11 text-muted-foreground" data-testid="err-session-briefing">
        这次没能读到上次的进展，不影响开始新对话。
      </p>
    );
  }
  if (hidden || items.length === 0) return null;

  const resume = (item: BriefingItem) => {
    onResume(item.resumePrompt);
    setCited(item);
    void recordSessionBriefingEvent("accepted", [item.itemId]).catch(() => undefined);
  };
  const dismiss = () => {
    setHidden(true);
    setDismissError(false);
    void recordSessionBriefingEvent("dismissed", items.map((i) => i.itemId)).catch(() => undefined);
    setSessionBriefingDismissed(true).catch(() => { setHidden(false); setDismissError(true); });
  };

  return (
    <section
      className="flex w-full max-w-lg flex-col gap-3 rounded-card border border-border-subtle bg-card p-4 text-left"
      aria-labelledby="session-briefing-title"
      data-testid="session-briefing"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 id="session-briefing-title" className="text-13 font-semibold text-card-foreground">接着上次</h2>
        <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="关闭开场简报" onClick={dismiss} data-testid="session-briefing-dismiss">
          <X aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </header>
      {briefingSections(items).map((s) => (
        <div key={s.section} className="flex flex-col gap-1.5" data-testid={`session-briefing-section-${s.section}`}>
          <h3 className="text-11 font-semibold text-muted-foreground">{s.label}</h3>
          <ul className="flex flex-col gap-1.5">
            {s.items.map((item) => (
              <li key={item.itemId} className="flex items-start gap-2 rounded-md border border-border-subtle bg-panel px-2.5 py-2" data-testid="session-briefing-item" data-item-id={item.itemId}>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-start gap-1.5">
                    <Badge tone="outline">{briefingKindLabel(item)}</Badge>
                    <p className="min-w-0 flex-1 text-12 text-card-foreground" data-testid="session-briefing-statement">{item.statement}</p>
                  </div>
                  {item.counterpart !== null ? (
                    <p className="text-11 text-muted-foreground" data-testid="session-briefing-counterpart">之前说的：{item.counterpart.statement}</p>
                  ) : null}
                  {item.goal !== null ? (
                    <p className="text-11 text-muted-foreground" data-testid="session-briefing-goal">为了：{item.goal.statement}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-1.5 text-10 text-muted-foreground">
                    <span>{briefingOriginLabel(item)}</span>
                    {item.cite.threadId !== null ? (
                      <Link
                        href={chatMemoryHref({ threadId: item.cite.threadId, projectId: null, claimId: item.cite.scope === "chat_session" ? item.cite.claimId : null })}
                        className="inline-flex items-center gap-0.5 rounded px-0.5 text-primary underline-offset-2 transition-colors hover:underline"
                        data-testid="session-briefing-source"
                      >
                        <MessageSquare aria-hidden className="h-3 w-3" />
                        看原话
                      </Link>
                    ) : null}
                  </div>
                </div>
                <Button size="xs" variant="outline" onClick={() => resume(item)} data-testid="session-briefing-resume">
                  <CornerDownRight aria-hidden className="h-3 w-3" />
                  续上
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {cited !== null ? (
        <p className="flex items-start gap-1.5 text-11 text-muted-foreground" data-testid="session-briefing-cited" data-claim-id={cited.cite.claimId}>
          <Quote aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
          <span>已把首问放进输入框，引用：{briefingCitationText(cited)}</span>
        </p>
      ) : null}
      {dismissError ? <p role="alert" className="text-11 text-destructive" data-testid="err-session-briefing-dismiss">没能关掉，请稍后再试。</p> : null}
    </section>
  );
}
