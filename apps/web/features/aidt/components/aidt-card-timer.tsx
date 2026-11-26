"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Timer } from "lucide-react";
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
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const durationMs = Number(minutes) * 60_000;

  return <div className="fixed bottom-20 right-4 z-40 flex flex-col items-end gap-2" data-testid="aidt-card-timer">
    {open && <div id={panelId} className="w-64 space-y-3 rounded-xl border bg-card p-3 text-card-foreground shadow-lg">
      <p className="font-medium">小组卡片计时器</p>
      {timer && <p role="status">{seconds === 0 ? "时间到" : timer.endsAtMs === null ? "已暂停" : "计时中"}</p>}
      {canControl && <div className="flex flex-wrap items-center gap-2">
        {!timer || seconds === 0 ? <>
          <label className="flex items-center gap-2">分钟
            <input type="number" min={1} max={1440} value={minutes} onChange={event => setMinutes(event.target.value)}
              className="w-20 rounded border bg-background p-1" />
          </label>
          <Button size="sm" disabled={busy || !Number.isInteger(Number(minutes)) || durationMs < 60000 || durationMs > 86400000}
            onClick={() => void send({ action: "start", durationMs })}>开始</Button>
        </> : <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void send({ action: "add", durationMs: 60000 })}>加 1 分钟</Button>
          <Button size="sm" disabled={busy} onClick={() => void send({ action: timer.endsAtMs === null ? "resume" : "pause" })}>
            {timer.endsAtMs === null ? "继续" : "暂停"}
          </Button>
        </>}
        {timer && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void send({ action: "close" })}>关闭计时</Button>}
      </div>}
      {!canControl && <p className="text-sm text-muted-foreground">当前只能查看计时。</p>}
      {error && <p role="alert">{error}</p>}
    </div>}
    <Button size="sm" variant="outline" className="rounded-full bg-card shadow-md" aria-expanded={open}
      aria-controls={open ? panelId : undefined} onClick={() => setOpen(!open)}>
      <Timer className="size-4" aria-hidden />{timer ? <span role="timer" className="tabular-nums">{time}</span> : "计时器"}
    </Button>
  </div>;
}
