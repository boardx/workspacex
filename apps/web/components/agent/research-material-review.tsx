"use client";

/**
 * 材料逐条审核 + 门① —— 三道人工硬门里的第一道，第一次变成用户**点得到**的东西。
 *
 * ## 为什么是「逐条」而不是一个「通过」按钮
 *
 * 需求文档把门①的判据定为「材料是否符合要求」，活动图里紧跟着一条回退箭头
 * 「标注缺失或错误点 → 仅对标注项重新采集」。**「仅对标注项」这四个字要求逐条**：
 * 只有一个整批通过/打回的按钮时，被打回的是整批，Agent 只能全部重来——
 * 那条回退箭头就白画了。
 *
 * 所以这里每条材料三个动作，且 `missing`/`wrong` 必须写清原因：原因就是重新采集的
 * 范围说明，写不清等于让 Agent 猜。
 *
 * ## 按钮为什么可能是禁用的，以及为什么必须说出来
 *
 * 门①在服务端的前置是「材料逐条判完」。前端**不重判这条规则**（那会变成第二处
 * 声明），但它必须能解释按钮为什么点不动——否则就是 team2 那个"点了没反应"的按钮。
 * 所以 `disabledReason` 由界面自己的可见状态推出一句人话，而**能不能真的过**
 * 仍然由服务端说了算：点下去被拒时，原样显示服务端给的 what + next。
 */
import * as React from "react";
import { AlertCircle, Check, FileQuestion, X } from "lucide-react";
import { researchWorkflow as C } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  explainResearchFailure,
  passResearchGate,
  reviewResearchMaterial,
  type ResearchSession,
} from "@/lib/live-research-workflow";

const VERDICT_META: Readonly<
  Record<Exclude<C.MaterialVerdictName, "pending">, { label: string; icon: typeof Check; tone: string }>
> = {
  accepted: { label: "通过", icon: Check, tone: "text-emerald-600 dark:text-emerald-400" },
  missing: { label: "缺失", icon: FileQuestion, tone: "text-amber-600 dark:text-amber-400" },
  wrong: { label: "有误", icon: X, tone: "text-destructive" },
};

export interface ResearchMaterialReviewProps {
  session: ResearchSession;
  onChange: (next: ResearchSession) => void;
}

export function ResearchMaterialReview({
  session,
  onChange,
}: ResearchMaterialReviewProps): JSX.Element | null {
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<{ what: string; next: string } | null>(null);
  const [notes, setNotes] = React.useState<Record<string, string>>({});

  // 只在门①真的在等的时候出现。别的阶段渲染它会让用户以为随时可以重审——
  // 而服务端会拒（PHASE_MISMATCH），又是一个假按钮。
  if (C.pendingGate(session.phase) !== "materials") return null;

  const pending = session.materials.filter((m) => m.verdict === "pending");
  const unresolved = session.materials.filter((m) => m.verdict !== "accepted");

  /**
   * 按钮为什么点不动——**一句话，按优先级只给一条**。
   * 给一串原因等于没给：用户要的是"我现在该做什么"，不是一份清单。
   */
  const disabledReason: string | null =
    session.materials.length === 0
      ? "还没有任何材料"
      : pending.length > 0
        ? `还有 ${pending.length} 条材料没有判定`
        : unresolved.length > 0
          ? `有 ${unresolved.length} 条标为缺失或有误，Agent 需要先重新采集`
          : null;

  async function act(fn: () => Promise<ResearchSession>) {
    setBusy(true);
    setFailure(null);
    try {
      onChange(await fn());
    } catch (e) {
      // 服务端才是权威。前端的 disabledReason 只是解释，不是判定——
      // 两者不一致时以这里显示的服务端理由为准。
      setFailure(explainResearchFailure(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="research-material-review"
      className="border-b border-border bg-background px-5 py-4 md:px-8"
    >
      <div className="mx-auto w-full max-w-screen-2xl space-y-3">
        <header className="space-y-1">
          <h2 className="text-12 font-semibold">{C.GATE_LABELS.materials}</h2>
          <p className="text-11 text-muted-foreground">
            逐条判定。标为「缺失」或「有误」的会被退回重新采集——
            请写清缺什么或哪里不对，那就是重采的范围说明。
            同一条最多重采 {C.MAX_COLLECTION_ATTEMPTS} 次。
          </p>
        </header>

        <ul className="space-y-2">
          {session.materials.map((m) => {
            const exhausted = m.attempts >= C.MAX_COLLECTION_ATTEMPTS;
            return (
              <li
                key={m.id}
                data-testid={`research-material-${m.id}`}
                data-verdict={m.verdict}
                className="rounded-md border border-border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-12">{m.label}</span>
                  <div className="flex items-center gap-1">
                    {(["accepted", "missing", "wrong"] as const).map((v) => {
                      const meta = VERDICT_META[v];
                      const Icon = meta.icon;
                      const active = m.verdict === v;
                      // 重采已用尽的材料不能再标为"要重采"的两态——标了也采不了，
                      // 那就是又一个点了没用的按钮。只留"通过"或维持原状。
                      const blocked = exhausted && v !== "accepted";
                      return (
                        <Button
                          key={v}
                          data-testid={`research-verdict-${m.id}-${v}`}
                          size="sm"
                          variant={active ? "primary" : "outline"}
                          disabled={busy || blocked}
                          title={blocked ? "这条材料的重采次数已用尽" : undefined}
                          onClick={() =>
                            void act(() =>
                              reviewResearchMaterial(session.threadId, m.id, v, notes[m.id]?.trim() || null),
                            )
                          }
                        >
                          <Icon aria-hidden className={cn("size-3", !active && meta.tone)} />
                          {meta.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>

                {/* 原因框只在"要退回"时才有意义，所以只在那两态下出现 */}
                {(m.verdict === "missing" || m.verdict === "wrong") ? (
                  <p data-testid={`research-material-note-${m.id}`} className="mt-2 text-11 text-muted-foreground">
                    {m.note ? `退回原因：${m.note}` : "⚠ 没写退回原因——Agent 只能猜该补什么"}
                    {` · 已重采 ${m.attempts}/${C.MAX_COLLECTION_ATTEMPTS} 次`}
                  </p>
                ) : null}

                {m.verdict === "pending" ? (
                  <input
                    data-testid={`research-note-input-${m.id}`}
                    value={notes[m.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [m.id]: e.target.value }))}
                    placeholder="若要退回，先写清缺什么 / 哪里不对"
                    className="mt-2 w-full rounded border border-border bg-background px-2 py-1 text-11"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>

        {failure ? (
          <p data-testid="research-gate-failure" className="flex items-start gap-1.5 text-11 text-destructive">
            <AlertCircle aria-hidden className="mt-0.5 size-3 shrink-0" />
            <span>
              {failure.what}。{failure.next}
            </span>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            data-testid="research-pass-gate-materials"
            // 同 research-gate-panel：默认 secondary 是灰底，与禁用态无法区分。
            variant="primary"
            disabled={busy || disabledReason !== null}
            onClick={() => void act(() => passResearchGate(session.threadId, "materials"))}
          >
            确认材料合格，进入下一步
          </Button>
          {/* 禁用的按钮**必须**说明自己为什么禁用。不说明的禁用按钮等同于坏掉——
              这条是 2026-09-15 team2 实测"点击开始没有反应"的直接教训。 */}
          {disabledReason ? (
            <span data-testid="research-gate-disabled-reason" className="text-11 text-muted-foreground">
              {disabledReason}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
