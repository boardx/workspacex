"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Pause, Play, Plus, Timer } from "lucide-react";
import { AidtTimerResponse, AIDT_TIMER_PATH, type AidtTimerAction } from "@repo/contracts/aidt-stages";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";

type Props = { projectId: string; stageId: number; entityId: string; sessionToken: string };

export function AidtCardTimer({ projectId, stageId, entityId, sessionToken }: Props) {
  const [sample, setSample] = useState<{ value: ReturnType<typeof AidtTimerResponse.parse>; received: number }>();
  const [tick, setTick] = useState(0);
  const [minutes, setMinutes] = useState("5");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const panelId = useId();
  const path = AIDT_TIMER_PATH.replace(":projectId", encodeURIComponent(projectId))
    .replace(":stageId", String(stageId)).replace(":entityId", encodeURIComponent(entityId));

  useEffect(() => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    async function poll() {
      const version = requestVersion.current;
      try {
        const value = AidtTimerResponse.parse(await apiRequest(path, { method: "GET", sessionToken, signal: controller.signal }));
        if (!controller.signal.aborted && version === requestVersion.current) setSample({ value, received: performance.now() });
      } catch {
        if (!controller.signal.aborted) setSample(previous => previous?.value.canControl
          ? { ...previous, value: { ...previous.value, canControl: false } }
          : previous);
      } finally {
        if (!controller.signal.aborted) timeout = setTimeout(poll, 3000);
      }
    }
    void poll();
    const ticker = setInterval(() => setTick(performance.now()), 250);
    return () => {
      controller.abort();
      clearTimeout(timeout);
      clearInterval(ticker);
    };
  }, [path, sessionToken]);

  async function send(command: AidtTimerAction) {
    requestVersion.current++;
    setBusy(true);
    setError("");
    try {
      const value = AidtTimerResponse.parse(await apiRequest(path, { method: "POST", sessionToken, body: command }));
      requestVersion.current++;
      setSample({ value, received: performance.now() });
      if (command.action === "close") setOpen(false);
    } catch {
      setError("计时器操作失败。请稍等同步后重试。");
    } finally {
      setBusy(false);
    }
  }

  if (!sample) return null;
  const { timer, nowMs, canControl } = sample.value;
  const remaining = timer?.endsAtMs == null
    ? timer?.remainingMs ?? 0
    : Math.max(0, timer.endsAtMs - nowMs - Math.max(0, tick - sample.received));
  const seconds = Math.ceil(remaining / 1000);
  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const durationMs = Number(minutes) * 60_000;

  const active = timer !== null && seconds > 0;
  const paused = active && timer.endsAtMs === null;
  const status = active ? paused ? "已暂停" : "计时中" : timer ? "时间到" : "设定时长";
  const canStart = Number.isInteger(Number(minutes)) && durationMs >= 60_000 && durationMs <= 86_400_000;

  return <div className="fixed bottom-20 right-4 z-40 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card text-card-foreground shadow-lg"
    data-testid="aidt-card-timer"
    onKeyDown={event => {
      if (event.key === "Escape" && open) {
        event.stopPropagation();
        event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
        setOpen(false);
      }
    }}>
    <Button type="button" size="md" variant="ghost"
      className={open ? "w-full justify-between rounded-t-2xl px-4 text-card-foreground" : "rounded-2xl px-3 text-card-foreground"}
      aria-label={open ? "收起小组计时器" : undefined}
      aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(!open)}>
      <span className="flex items-center gap-2">
        <Timer className="size-4" aria-hidden />
        {open || !timer ? "小组计时" : <><span className="sr-only">小组计时，{status}，剩余</span><span className="font-mono tabular-nums">{time}</span></>}
      </span>
      {open && <ChevronDown className="size-4 text-muted-foreground" aria-hidden />}
    </Button>

    {open && <div id={panelId} className="w-72 max-w-full space-y-3 px-3 pb-3">
      <div className="grid justify-items-center gap-1 rounded-xl bg-muted px-3 py-4">
        <span role="status" className={timer && seconds === 0 ? "text-12 font-medium text-destructive" : "text-12 text-muted-foreground"}>{status}</span>
        <span role={timer ? "timer" : undefined} aria-label={timer ? "剩余时间" : undefined}
          className="font-mono text-4xl font-semibold leading-none tracking-tight tabular-nums">
          {timer ? time : `${canStart ? minutes.padStart(2, "0") : "––"}:00`}
        </span>
      </div>
      {canControl && (active ? <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="primary" disabled={busy} onClick={() => void send({ action: paused ? "resume" : "pause" })}>
          {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
          {paused ? "继续" : "暂停"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void send({ action: "add", durationMs: 60_000 })}>
          <Plus className="size-4" aria-hidden />加 1 分钟
        </Button>
      </div> : <form className="space-y-2" onSubmit={event => {
        event.preventDefault();
        if (canStart && !busy) void send({ action: "start", durationMs });
      }}>
        <div className="grid grid-cols-3 gap-2" aria-label="常用时长">
          {[5, 10, 15].map(preset => <Button key={preset} type="button" size="sm" aria-pressed={Number(minutes) === preset}
            variant={Number(minutes) === preset ? "secondary" : "outline"} onClick={() => setMinutes(String(preset))}>
            {preset} 分钟
          </Button>)}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-12 text-muted-foreground">
            <input type="number" min={1} max={1440} value={minutes} aria-label="自定义分钟数"
              onChange={event => setMinutes(event.target.value)}
              className="h-9 min-w-0 flex-1 rounded-control border border-border bg-background px-2 text-13 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            分钟
          </label>
          <Button type="submit" variant="primary" disabled={busy || !canStart}><Play className="size-4" aria-hidden />开始</Button>
        </div>
      </form>)}
      {canControl && timer && <div className="flex justify-center border-t border-border-subtle pt-1">
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void send({ action: "close" })}>结束小组计时</Button>
      </div>}
      {!canControl && <p className="text-12 text-muted-foreground">当前只能查看计时。</p>}
      {error && <p role="alert" className="text-12 text-destructive">{error}</p>}
    </div>}
  </div>;
}
