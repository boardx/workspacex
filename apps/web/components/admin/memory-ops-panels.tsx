"use client";
import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import {
  getConsolidationSetting, getExtractionSlo, runConsolidationNow, setConsolidationSetting,
  type ConsolidationPassOut, type ExtractionSloOut,
} from "@/lib/live-memory-ops";

/**
 * Phase 18 S8（#4365）—— 平台后台「运营状态」屏里、紧挨着「记忆抽取（整个部署）」开关的两块：
 *
 * - 「记忆抽取 SLO」：p95 延迟、失败率、卡住的租约（三个 SLO 指标，超阈值时顶部出横幅），以及「值得记」门控
 *   省下了多少次抽取模型调用。延迟 / 失败率 / 门控计数是**本实例**最近一小时；卡住的租约 / 死信 / 积压是全库现数。
 * - 「记忆整合」：部署级开关（**默认关**），以及「现在整合一次」（只回计数，不显示任何人的记忆内容——整合改了谁的哪一条，
 *   只有本人在自己的大脑页看得到、撤得动）。
 *
 * 权限形状同 `platform-extraction-setting-panel.tsx`：403 `NOT_PLATFORM_SUPERUSER` 渲染成一句说明、不画控件。
 */

const FORBIDDEN_TEXT = "这项设置仅平台运维（平台超管白名单，或被超管指定的平台管理员）可用——你当前的账号不是。";

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && (err.reasonCode === "NOT_PLATFORM_SUPERUSER" || err.status === 403);
}

function failureText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.reasonCode === "KG_CONSOLIDATION_DISABLED") return "记忆整合开关关着，先打开再整合。";
    return httpFailureText(err.status);
  }
  if (err instanceof TypeError) return "连不上服务器，检查一下网络再试";
  return "出了点问题，稍后再试一次";
}

type Load<T> = { kind: "loading" } | { kind: "ready"; out: T } | { kind: "forbidden" } | { kind: "failed"; message: string };

function useLoad<T>(fetcher: () => Promise<T>): [Load<T>, () => Promise<void>, React.Dispatch<React.SetStateAction<Load<T>>>] {
  const [load, setLoad] = React.useState<Load<T>>({ kind: "loading" });
  const reload = React.useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      setLoad({ kind: "ready", out: await fetcher() });
    } catch (err) {
      setLoad(isForbidden(err) ? { kind: "forbidden" } : { kind: "failed", message: failureText(err) });
    }
  }, [fetcher]);
  React.useEffect(() => { void reload(); }, [reload]);
  return [load, reload, setLoad];
}

const METRIC_LABEL: Record<ExtractionSloOut["alerts"][number]["metric"], string> = {
  p95_latency: "p95 延迟",
  failure_rate: "失败率",
  stuck_leases: "卡住的租约",
};

const ms = (v: number | null) => (v === null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} 秒` : `${Math.round(v)} 毫秒`);
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const alertValue = (a: ExtractionSloOut["alerts"][number]) =>
  a.metric === "p95_latency" ? `${ms(a.value)}（阈值 ${ms(a.threshold)}）`
    : a.metric === "failure_rate" ? `${pct(a.value)}（阈值 ${pct(a.threshold)}）` : `${a.value} 条（阈值 ${a.threshold} 条）`;

function Stat({ label, value, hint, breached, testId }: { label: string; value: string; hint?: string; breached?: boolean; testId: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 rounded-md border p-3 ${breached ? "border-destructive bg-card" : "border-border bg-card"}`} data-testid={testId}>
      <span className="text-11 text-muted-foreground">{label}</span>
      <span className={`tabular-nums text-16 font-semibold ${breached ? "text-destructive" : "text-card-foreground"}`}>{value}</span>
      {hint !== undefined && <span className="text-10 text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function ExtractionSloPanel() {
  const fetcher = React.useCallback(() => getExtractionSlo(), []);
  const [load, reload] = useLoad<ExtractionSloOut>(fetcher);
  const breached = (m: ExtractionSloOut["alerts"][number]["metric"]) => load.kind === "ready" && load.out.alerts.some((a) => a.metric === m);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4" data-testid="admin-extraction-slo">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-13 font-semibold">记忆抽取 SLO</h3>
          <p className="text-11 text-muted-foreground">
            抽取有多快、失败多不多、有没有卡住的任务。延迟、失败率和门控计数是本实例最近一小时的数；卡住的租约、死信和积压是整个部署的现数。
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void reload()} disabled={load.kind === "loading"} data-testid="admin-extraction-slo-refresh">
          刷新
        </Button>
      </div>
      {load.kind === "loading" && (
        <p className="flex items-center gap-1.5 text-12 text-muted-foreground" data-testid="admin-extraction-slo-loading">
          <Loader2 aria-hidden className="h-3 w-3 animate-spin" />加载中……
        </p>
      )}
      {load.kind === "forbidden" && <p className="text-12 text-muted-foreground" data-testid="admin-extraction-slo-forbidden">{FORBIDDEN_TEXT}</p>}
      {load.kind === "failed" && (
        <p className="text-12 text-destructive" data-testid="admin-extraction-slo-failed">读取记忆抽取 SLO 失败：{load.message}</p>
      )}
      {load.kind === "ready" && (
        <>
          {load.out.alerts.length > 0 ? (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive bg-card p-3" data-testid="admin-extraction-slo-alert">
              <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="flex flex-col gap-0.5">
                <p className="text-12 font-medium text-destructive">记忆抽取超出 SLO 阈值</p>
                <ul className="text-11 text-card-foreground">
                  {load.out.alerts.map((a) => (
                    <li key={a.metric} data-testid={`admin-extraction-slo-alert-${a.metric}`}>{METRIC_LABEL[a.metric]}：{alertValue(a)}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-11 text-muted-foreground" data-testid="admin-extraction-slo-ok">三个指标都在阈值内。</p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Stat testId="admin-extraction-slo-p95" label="p95 延迟" value={ms(load.out.p95LatencyMs)}
              hint={`阈值 ${ms(load.out.thresholds.p95LatencyMs)} · ${load.out.processed} 条样本`} breached={breached("p95_latency")} />
            <Stat testId="admin-extraction-slo-failure-rate" label="失败率" value={pct(load.out.failureRate)}
              hint={`阈值 ${pct(load.out.thresholds.failureRate)} · ${load.out.failed}/${load.out.modelJobs} 次模型抽取`} breached={breached("failure_rate")} />
            <Stat testId="admin-extraction-slo-stuck" label="卡住的租约" value={`${load.out.stuckLeases} 条`}
              hint={`阈值 ${load.out.thresholds.stuckLeases} 条 · 死信 ${load.out.deadLetters} · 积压 ${load.out.backlog}`} breached={breached("stuck_leases")} />
          </div>
          <div className="flex flex-col gap-0.5 rounded-md border border-border bg-card p-3" data-testid="admin-extraction-gate">
            <p className="text-12 font-medium text-card-foreground">「值得记」门控</p>
            <p className="text-11 text-muted-foreground" data-testid="admin-extraction-gate-saved">
              省下 {load.out.gate.modelCallsSaved} 次抽取模型调用（寒暄 {load.out.gate.skippedByReason.greeting}、应答 {load.out.gate.skippedByReason.acknowledgement}、
              纯提问 {load.out.gate.skippedByReason.pure_question}、模型判不值得 {load.out.gate.skippedByReason.model_not_worth}），
              实际调用 {load.out.gate.modelCalls} 次。目标、偏好、决定永远不会被跳过。
            </p>
            <p className="text-10 text-muted-foreground">
              便宜模型复核：{load.out.gate.gateModelEnabled ? `已开启（${load.out.gate.gateModelChecks} 次，出错 ${load.out.gate.gateModelErrors} 次——出错时照常抽取）` : "未开启（只用规则）"}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export function ConsolidationSettingPanel() {
  const fetcher = React.useCallback(() => getConsolidationSetting(), []);
  const [load, reload, setLoad] = useLoad(fetcher);
  const [saving, setSaving] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [lastPass, setLastPass] = React.useState<ConsolidationPassOut | null>(null);

  const toggle = async (next: boolean) => {
    if (saving || load.kind !== "ready") return;
    const previous = load.out;
    setSaving(true);
    setMessage(null);
    setLoad({ kind: "ready", out: { enabled: next } });
    try {
      setLoad({ kind: "ready", out: await setConsolidationSetting(next) });
    } catch (err) {
      if (isForbidden(err)) setLoad({ kind: "forbidden" });
      else {
        setLoad({ kind: "ready", out: previous });
        setMessage({ tone: "error", text: `没保存成功，仍是${previous.enabled ? "开启" : "关闭"}：${failureText(err)}` });
      }
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    if (running) return;
    setRunning(true);
    setMessage(null);
    try {
      const out = await runConsolidationNow();
      setLastPass(out);
      setMessage({ tone: "ok", text: `整合完成：处理了 ${out.users} 人，合并 ${out.claimMerges} 条重复记忆、${out.entityMerges} 个实体写法，开了 ${out.conflicts} 张冲突卡。` });
    } catch (err) {
      if (isForbidden(err)) setLoad({ kind: "forbidden" });
      else setMessage({ tone: "error", text: `整合没有跑：${failureText(err)}` });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4" data-testid="admin-consolidation">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-13 font-semibold">记忆整合（整个部署）</h3>
        <p className="text-11 text-muted-foreground">
          定期整理每个人的长期记忆：把说了两遍的同一件事合成一条（来源都保留）、把同一个东西的不同写法合成一个、发现彼此矛盾时开一张冲突卡让本人决定——
          从不替人裁决。每次整合本人都能在大脑页看到、一键撤销。默认关闭。
        </p>
      </div>
      {load.kind === "loading" && (
        <p className="flex items-center gap-1.5 text-12 text-muted-foreground"><Loader2 aria-hidden className="h-3 w-3 animate-spin" />加载中……</p>
      )}
      {load.kind === "forbidden" && <p className="text-12 text-muted-foreground" data-testid="admin-consolidation-forbidden">{FORBIDDEN_TEXT}</p>}
      {load.kind === "failed" && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-12 text-destructive" data-testid="admin-consolidation-failed">读取记忆整合设置失败：{load.message}</p>
          <Button size="sm" variant="secondary" onClick={() => void reload()}>重试</Button>
        </div>
      )}
      {load.kind === "ready" && (
        <>
          <div className="flex items-start gap-3">
            <Toggle
              checked={load.out.enabled}
              label="为整个部署开启记忆整合"
              disabled={saving}
              onCheckedChange={(v) => void toggle(v)}
              data-testid="admin-consolidation-toggle"
              className="mt-0.5"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-12 font-medium text-card-foreground">
                为整个部署开启记忆整合
                <span className="ml-1.5 text-11 font-normal text-muted-foreground" data-testid="admin-consolidation-state">
                  {load.out.enabled ? "已开启" : "已关闭"}
                </span>
                {saving && <Loader2 aria-hidden className="ml-1.5 inline h-3 w-3 animate-spin" />}
              </p>
              <p className="text-11 text-muted-foreground">
                {load.out.enabled ? "生效中：后台每 6 小时为有新记忆的人整合一次。" : "未生效：不会整合任何人的记忆。"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void runNow()} disabled={running || !load.out.enabled} data-testid="admin-consolidation-run">
              {running ? "整合中……" : "现在整合一次"}
            </Button>
            {lastPass !== null && lastPass.failedUsers > 0 && (
              <span className="text-11 text-destructive">{lastPass.failedUsers} 人整合失败（见服务端日志）</span>
            )}
          </div>
        </>
      )}
      {message !== null && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`text-11 ${message.tone === "error" ? "text-destructive" : "text-muted-foreground"}`} data-testid="admin-consolidation-message">
          {message.text}
        </p>
      )}
    </div>
  );
}
