"use client";
import * as React from "react";
import { Target, UserRound } from "lucide-react";
import { KG_CLAIM_KIND_LABEL_ZH } from "@/lib/knowledge-graph-view";
import { ClaimTriStateBadge } from "@/components/chat/knowledge/claim-tri-state-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { aboutMe } from "@/lib/about-me-view";
import { forgetFromBrain } from "@/lib/brain-memory-actions";
import { forgetPlan, originsByClaim, type PersonalClaimOrigin } from "@/lib/brain-view";
import {
  fetchSessionBriefing, revisePersonalClaim, setGoalLink, setSessionBriefingDismissed, type PersonalKnowledge,
} from "@/lib/knowledge-graph-api";
import { BRAIN_FORGET_STILL_LIVE_ZH, describeBrainActionFailure } from "@/lib/knowledge-graph-failure";
import { OriginLinks } from "./personal-memory";

type Claim = PersonalKnowledge["claims"][number];
interface ActionError { readonly claimId: string; readonly message: string }

/** 挂目标下拉里「不挂」那一项的值（目标 id 不会是空串）。 */
const NO_GOAL = "";

/**
 * issue #4360「关于我」：/brain 个人空间顶部。按 目标 / 偏好 / 约束与身份 / 在做的事 列出长期记忆里描述「你」的条目，
 * 在做的事（决定 / 待办）挂在它服务的目标下面。每条可以直接改写、忘掉，并能点回它出自的对话。
 *
 *   - 改写：`revisePersonalClaim`——新说法成为「你确认过」的一条，旧的折叠为「取代了」，挂接跟着走；
 *   - 忘掉：与下面「我的长期记忆」同一个动作（`forgetPlan` + `forgetFromBrain`，复用对话里的既有动作）；
 *   - 挂到目标：`setGoalLink`（AI 只在很有把握时自动挂，这里随时改挂 / 摘掉）。
 * 另外：新对话的开场简报关掉过的话，这里给一个「重新打开」。
 */
export function AboutMe({
  personal, origins, onChanged,
}: {
  personal: PersonalKnowledge;
  origins: readonly PersonalClaimOrigin[];
  onChanged: () => Promise<PersonalKnowledge>;
}) {
  const view = React.useMemo(() => aboutMe(personal), [personal]);
  const byClaim = React.useMemo(() => originsByClaim(origins), [origins]);
  const goals = view.groups.find((g) => g.section === "goals")?.claims ?? [];
  const [pending, setPending] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ claimId: string; text: string } | null>(null);
  const [error, setError] = React.useState<ActionError | null>(null);

  const run = async (claimId: string, act: () => Promise<void>, check: (fresh: PersonalKnowledge) => string | null = () => null) => {
    if (pending !== null) return;
    setPending(claimId);
    setError(null);
    try {
      await act();
      const fresh = await onChanged().catch(() => null);
      const notDone = fresh === null ? null : check(fresh);
      if (notDone !== null) setError({ claimId, message: notDone });
    } catch (e) {
      setError({ claimId, message: describeBrainActionFailure(e) });
      await onChanged().catch(() => undefined);
    } finally {
      setPending(null);
    }
  };
  const save = (c: Claim, text: string) => {
    const next = text.trim();
    if (next === "" || next === c.statement) { setEditing(null); return; }
    void run(c.id, async () => { await revisePersonalClaim(c.id, next); setEditing(null); });
  };
  const forget = (c: Claim) => {
    const steps = forgetPlan(c, byClaim.get(c.id) ?? []);
    if (steps === null) return;
    void run(c.id, () => forgetFromBrain(steps), (fresh) => (fresh.claims.some((x) => x.id === c.id) ? BRAIN_FORGET_STILL_LIVE_ZH : null));
  };
  const link = (c: Claim, goalId: string) => {
    void run(c.id, async () => { await setGoalLink(c.id, goalId === NO_GOAL ? null : goalId); });
  };

  const item = (c: Claim, nested: boolean) => {
    const from = byClaim.get(c.id) ?? [];
    const isEditing = editing?.claimId === c.id;
    const canForget = forgetPlan(c, from) !== null;
    const doing = c.kind === "decision" || c.kind === "todo";
    const children = view.childrenOf.get(c.id) ?? [];
    return (
      <li
        key={c.id}
        className={nested ? "flex flex-col gap-1.5 rounded-md border border-border-subtle bg-panel p-2.5" : "flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3"}
        data-testid="about-me-item"
        data-claim-id={c.id}
      >
        {isEditing ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(ev) => { ev.preventDefault(); save(c, editing.text); }}
          >
            <Input
              value={editing.text}
              onChange={(ev) => setEditing({ claimId: c.id, text: ev.target.value })}
              aria-label="改写这一条"
              className="min-w-0 flex-1"
              autoFocus
              data-testid="about-me-edit-input"
            />
            <Button size="xs" variant="primary" type="submit" disabled={pending !== null || editing.text.trim() === ""} data-testid="about-me-edit-save">
              保存
            </Button>
            <Button size="xs" variant="ghost" type="button" onClick={() => setEditing(null)} data-testid="about-me-edit-cancel">取消</Button>
          </form>
        ) : (
          <div className="flex items-start gap-2">
            {nested ? <Badge tone="outline">{KG_CLAIM_KIND_LABEL_ZH[c.kind]}</Badge> : null}
            <p className="min-w-0 flex-1 text-13" data-testid="about-me-statement">{c.statement}</p>
            <ClaimTriStateBadge status={c.status} />
          </div>
        )}
        <OriginLinks origins={from} />
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {doing && goals.length > 0 ? (
            <label className="mr-auto inline-flex items-center gap-1.5 text-11 text-muted-foreground">
              <Target aria-hidden className="h-3 w-3" />
              为了
              <Select
                className="h-6 min-w-[8rem] text-11"
                value={view.goalOf.get(c.id) ?? NO_GOAL}
                options={[{ value: NO_GOAL, label: "不挂到目标" }, ...goals.map((g) => ({ value: g.id, label: g.statement }))]}
                onValueChange={(v) => link(c, v)}
                disabled={pending !== null}
                data-testid="about-me-goal-select"
              />
            </label>
          ) : null}
          {!isEditing ? (
            <Button size="xs" variant="ghost" disabled={pending !== null} onClick={() => setEditing({ claimId: c.id, text: c.statement })} data-testid="about-me-edit">
              改写
            </Button>
          ) : null}
          {canForget ? (
            <Button size="xs" variant="ghost" disabled={pending !== null} onClick={() => forget(c)} data-testid="about-me-forget">
              忘掉这条
            </Button>
          ) : null}
        </div>
        {error?.claimId === c.id ? <p role="alert" className="text-11 text-destructive" data-testid="err-about-me">{error.message}</p> : null}
        {children.length > 0 ? (
          <div className="flex flex-col gap-1.5 border-l-2 border-border-subtle pl-3" data-testid="about-me-goal-children">
            <p className="text-11 text-muted-foreground">为这个目标在做的事 · {children.length}</p>
            <ul className="flex flex-col gap-1.5">{children.map((x) => item(x, true))}</ul>
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-muted p-4" data-testid="about-me" aria-labelledby="about-me-title">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-center gap-2">
          <UserRound aria-hidden className="h-4 w-4 text-muted-foreground" />
          <h2 id="about-me-title" className="text-14 font-semibold">关于我</h2>
          <span className="tabular-nums text-11 text-muted-foreground" data-testid="about-me-count">{view.total}</span>
        </div>
        <p className="text-11 text-muted-foreground">开新对话时我会先想起这些，不用你再交代一遍。</p>
      </header>
      {error !== null && !personal.claims.some((c) => c.id === error.claimId) ? (
        <p role="alert" className="text-11 text-destructive" data-testid="err-about-me">{error.message}</p>
      ) : null}
      {view.total === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-4 text-center text-12 text-muted-foreground" data-testid="about-me-empty">
          还不了解你。在对话里说说你的目标（「我的目标是…」）、偏好（「我更喜欢…」）或你是谁，我会记在这里。
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {view.groups.map((g) => (
            <div key={g.section} className="flex min-w-0 flex-col gap-2" data-testid={`about-me-group-${g.section}`}>
              <h3 className="text-11 font-semibold text-muted-foreground">{g.label} · {g.claims.length}</h3>
              {g.claims.length === 0 ? (
                <p className="text-11 text-muted-foreground" data-testid={`about-me-group-empty-${g.section}`}>暂无</p>
              ) : (
                <ul className="flex flex-col gap-2">{g.claims.map((c) => item(c, false))}</ul>
              )}
            </div>
          ))}
        </div>
      )}
      <BriefingPreference />
    </section>
  );
}

/** 开场简报关掉过 ⇒ 一行「重新打开」；没关过 / 读不到 ⇒ 什么都不显示（不是这一页的主要内容）。 */
function BriefingPreference() {
  const [dismissed, setDismissed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    const ctl = new AbortController();
    fetchSessionBriefing(ctl.signal).then((b) => { if (!ctl.signal.aborted) setDismissed(b.dismissed); }, () => undefined);
    return () => ctl.abort();
  }, []);
  if (!dismissed) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-11 text-muted-foreground" data-testid="about-me-briefing-off">
      <span>新对话开头的「接着上次」简报已关闭。</span>
      <Button
        size="xs"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          setSessionBriefingDismissed(false).then((r) => setDismissed(r.dismissed), () => setFailed(true)).finally(() => setBusy(false));
        }}
        data-testid="about-me-briefing-reopen"
      >
        重新打开
      </Button>
      {failed ? <span role="alert" className="text-destructive" data-testid="err-about-me-briefing">没能打开，请稍后再试。</span> : null}
    </div>
  );
}
