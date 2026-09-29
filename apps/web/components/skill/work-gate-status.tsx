"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api-client";
import { getWorkGateStatus, type WorkGateBadgeState, type WorkGateView } from "@/lib/live-work-skill";

/**
 * EV04 —— Work Skill 目录的门状态展示（契约束 `work-eval` R8：`GET /skills/catalog/:skillId/gate-status`）。
 *
 *   · 详情抽屉：G0–G5 六门逐行列出（`work-gate-badge-<G>` + `data-state`，原因与判定时间
 *     `work-gate-reason-<G>` 直接可见）、评测版本 `work-gate-version`、套件 `work-gate-suite-id`、
 *     subject vs baseline 通过数 `work-gate-score`（如 `9/10 vs 6/10`，未评测显示「—」）——testid 以
 *     契约束 work-eval ui.md 第二节为准；
 *   · 未评测空态；报告过期（stale，E4）黄色提示；
 *   · 读取失败时保留上一次成功的数据、只做局部提示，不报整页错；
 *   · 列表行缩略只给 G4/G5（契约 `WorkGateSummary`）。
 * 门状态只读——前端不提供任何改门字段的入口（R5）。
 */

const STATE_LABEL: Record<WorkGateBadgeState, string> = {
  pass: "通过",
  fail: "未通过",
  not_applicable: "不适用",
  not_evaluated: "未评测",
};
const STATE_MARK: Record<WorkGateBadgeState, string> = { pass: "✓", fail: "✗", not_applicable: "–", not_evaluated: "?" };
const STATE_TONE = { pass: "success", fail: "danger", not_applicable: "outline", not_evaluated: "outline" } as const;

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function ratio(passed: number | null, total: number | null): string {
  return passed === null ? "—" : `${passed}/${total ?? "?"}`;
}

type PanelState =
  | { status: "loading" }
  | { status: "ready"; view: WorkGateView; refreshError: string | null }
  | { status: "error"; message: string };

function errorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 404) return "未找到该 Skill 的门状态";
  if (e instanceof ApiError && e.status === 401) return "登录已过期，请重新登录";
  return "暂时读不到门状态，请稍后重试";
}

export function WorkGateStatusPanel({ skillId, refreshKey = 0 }: { skillId: string; refreshKey?: number }) {
  const [state, setState] = React.useState<PanelState>({ status: "loading" });
  React.useEffect(() => {
    let alive = true;
    getWorkGateStatus(skillId).then(
      (view) => {
        if (alive) setState({ status: "ready", view, refreshError: null });
      },
      (e: unknown) => {
        if (!alive) return;
        // 已有数据时保留旧数据，只加局部提示。
        setState((prev) =>
          prev.status === "ready" ? { ...prev, refreshError: errorText(e) } : { status: "error", message: errorText(e) });
      },
    );
    return () => {
      alive = false;
    };
  }, [skillId, refreshKey]);

  return (
    <section className="flex flex-col gap-1.5" data-testid="work-skill-gates">
      <h3 className="font-medium">评测套件与门状态</h3>
      {state.status === "loading" && <p className="text-muted-foreground">加载中…</p>}
      {state.status === "error" && (
        <p data-testid="work-gate-state-error" className="text-muted-foreground">门状态读取失败：{state.message}</p>
      )}
      {state.status === "ready" && <GateViewBody view={state.view} refreshError={state.refreshError} />}
    </section>
  );
}

function GateViewBody({ view, refreshError }: { view: WorkGateView; refreshError: string | null }) {
  const evaluated = view.decidedAt !== null;
  return (
    <>
      {!evaluated && (
        <p data-testid="work-gate-state-not-evaluated" className="rounded-control bg-muted px-2 py-1 text-muted-foreground">
          当前版本尚未评测，六门均为「未评测」（不视为通过）。
        </p>
      )}
      {view.stale && (
        <p data-testid="work-gate-stale" className="rounded-control border border-warning/30 bg-warning/5 px-2 py-1 text-warning">
          评测报告已过期：当前版本尚未重新评测，请重新评测。
        </p>
      )}
      {refreshError && (
        <p data-testid="work-gate-refresh-error" className="text-11 text-muted-foreground">
          刷新失败，显示的是上次读取的结果（{refreshError}）。
        </p>
      )}
      {/* G0–G5 明细：每门一行，原因与判定时间直接可见（不只藏在悬停里）。 */}
      <ul className="flex flex-col gap-1" data-testid="work-gate-badges" aria-label="G0–G5 门状态">
        {view.gates.map((g) => {
          const when = `判定时间 ${formatTime(view.decidedAt)}`;
          const title = `${g.gate} ${STATE_LABEL[g.state]}${g.reason ? ` · ${g.reason}` : ""} · ${when}`;
          return (
            <li key={g.gate} className="flex items-start gap-2" data-testid={`work-gate-badge-${g.gate}`} data-state={g.state}>
              <Badge tone={STATE_TONE[g.state]} title={title}>
                {g.gate} {STATE_MARK[g.state]} {STATE_LABEL[g.state]}
              </Badge>
              <span data-testid={`work-gate-reason-${g.gate}`} className="text-11 text-muted-foreground">
                {g.state === "not_evaluated" ? "尚未评测" : g.reason ?? STATE_LABEL[g.state]}
                {evaluated && <> · {when}</>}
              </span>
            </li>
          );
        })}
      </ul>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-11">
        <dt className="text-muted-foreground">评测套件</dt>
        <dd data-testid="work-gate-suite-id">{view.evalSuiteId ?? "（无）"}</dd>
        <dt className="text-muted-foreground">评测版本</dt>
        <dd data-testid="work-gate-version">{view.semanticLabel}</dd>
        <dt className="text-muted-foreground">通过数（本体 vs 基线）</dt>
        <dd data-testid="work-gate-score">
          {evaluated && view.subjectPassed !== null
            ? `${ratio(view.subjectPassed, view.deterministicTotal)} vs ${ratio(view.baselinePassed, view.deterministicTotal)}`
            : "—"}
        </dd>
      </dl>
    </>
  );
}

/** 列表行缩略（如「G4✓ G5✗」）；读失败则不渲染，不影响行本身。 */
export function WorkGateSummaryBadge({ skillId }: { skillId: string }) {
  const [view, setView] = React.useState<WorkGateView | null>(null);
  React.useEffect(() => {
    let alive = true;
    getWorkGateStatus(skillId).then(
      (v) => {
        if (alive) setView(v);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [skillId]);
  if (!view) return null;
  const pick = (gate: "G4" | "G5") => view.gates.find((g) => g.gate === gate)?.state ?? "not_evaluated";
  const g4 = pick("G4");
  const g5 = pick("G5");
  return (
    <span data-testid="work-catalog-gate-summary" className="text-11 text-muted-foreground" title={`G4 ${STATE_LABEL[g4]} · G5 ${STATE_LABEL[g5]}`}>
      G4{STATE_MARK[g4]} G5{STATE_MARK[g5]}
    </span>
  );
}
