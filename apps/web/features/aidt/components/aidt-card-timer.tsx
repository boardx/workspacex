"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Pause, Play, Plus, Timer } from "lucide-react";
import { AidtTimerResponse, AIDT_TIMER_PATH, type AidtTimerAction } from "@repo/contracts/aidt-stages";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";

function keepTimerInView(left: number, top: number, bounds: DOMRect) {
  return {
    left: Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8)),
    top: Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8)),
  };
}

type Props = { projectId: string; stageId: number; entityId: string; sessionToken: string };

export function AidtCardTimer({ projectId, stageId, entityId, sessionToken }: Props) {
  const [sample, setSample] = useState<{ value: ReturnType<typeof AidtTimerResponse.parse>; received: number }>();
  const [tick, setTick] = useState(0);
  const [minutes, setMinutes] = useState("5");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const floating = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number; startX: number; startY: number }>();
  const dragged = useRef(false);
  const requestVersion = useRef(0);
  const panelId = useId();
  const path = AIDT_TIMER_PATH.replace(":projectId", encodeURIComponent(projectId))
    .replace(":stageId", String(stageId)).replace(":entityId", encodeURIComponent(entityId));

  useEffect(() => {
    let session: { id: string; controller: AbortController; timeout?: ReturnType<typeof setTimeout> } | undefined;

    function enter() {
      if (session) return;
      const room = { id: crypto.randomUUID(), controller: new AbortController(), timeout: undefined as ReturnType<typeof setTimeout> | undefined };
      session = room;
      async function poll() {
        const version = requestVersion.current;
        const { signal } = room.controller;
        try {
          const value = AidtTimerResponse.parse(await apiRequest(path, {
            method: "POST", sessionToken, signal, body: { action: "heartbeat", sessionId: room.id },
          }));
          if (!signal.aborted && version === requestVersion.current) setSample({ value, received: performance.now() });
        } catch {
          if (!signal.aborted && version === requestVersion.current) {
            setSample(previous => previous?.value.canControl
              ? { ...previous, value: { ...previous.value, canControl: false } }
              : previous);
          }
        } finally {
          if (!signal.aborted) room.timeout = setTimeout(poll, 3000);
        }
      }
      void poll();
    }

    function leave() {
      if (!session) return;
      const room = session;
      session = undefined;
      room.controller.abort();
      clearTimeout(room.timeout);
      void apiRequest(path, {
        method: "POST", sessionToken, keepalive: true, body: { action: "leave", sessionId: room.id },
      }).catch(() => { /* The server expires the lease if delivery fails. */ });
    }

    enter();
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", enter);
    const ticker = setInterval(() => setTick(performance.now()), 250);
    return () => {
      leave();
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", enter);
      clearInterval(ticker);
    };
  }, [path, sessionToken]);

  const hasSample = Boolean(sample);
  useEffect(() => {
    const element = floating.current;
    if (!hasSample || !element) return;
    const panel = element;
    function clampPosition() {
      setPosition(previous => previous && keepTimerInView(previous.left, previous.top, panel.getBoundingClientRect()));
    }
    const observer = new ResizeObserver(clampPosition);
    observer.observe(element);
    window.addEventListener("resize", clampPosition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", clampPosition);
    };
  }, [hasSample]);

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
  const { timer, nowMs, canControl, roomCount } = sample.value;
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

  return <div ref={floating}
    className={`fixed z-40 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-border bg-card text-card-foreground shadow-lg ${position ? "max-h-[calc(100dvh-1rem)]" : "bottom-20 right-4 max-h-[calc(100dvh-6rem)]"}`}
    style={position}
    data-testid="aidt-card-timer"
    onKeyDown={event => {
      if (event.key === "Escape" && open) {
        event.stopPropagation();
        event.currentTarget.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus();
        setOpen(false);
      }
    }}>
    <Button type="button" size="md" variant="ghost"
      className={`touch-none select-none cursor-grab active:cursor-grabbing text-card-foreground ${open ? "w-full justify-between rounded-t-2xl px-4" : "rounded-2xl px-3"}`}
      aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={event => {
        if (event.detail !== 0 && dragged.current) return;
        setOpen(previous => !previous);
      }}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0 || !floating.current) return;
        const bounds = floating.current.getBoundingClientRect();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragged.current = false;
        drag.current = {
          pointerId: event.pointerId,
          offsetX: event.clientX - bounds.left,
          offsetY: event.clientY - bounds.top,
          startX: event.clientX,
          startY: event.clientY,
        };
      }}
      onPointerMove={event => {
        const pointer = drag.current;
        if (pointer?.pointerId !== event.pointerId || !floating.current) return;
        if (!dragged.current && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 6) return;
        dragged.current = true;
        setPosition(keepTimerInView(event.clientX - pointer.offsetX, event.clientY - pointer.offsetY, floating.current.getBoundingClientRect()));
      }}
      onLostPointerCapture={event => {
        if (drag.current?.pointerId === event.pointerId) drag.current = undefined;
      }}
      onKeyDown={event => {
        const offsets: Record<string, [number, number]> = {
          ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16],
        };
        const offset = offsets[event.key];
        if (!offset || !floating.current) return;
        event.preventDefault();
        const bounds = floating.current.getBoundingClientRect();
        setPosition(keepTimerInView(bounds.left + offset[0], bounds.top + offset[1], bounds));
      }}>
      <span className="flex items-center gap-2">
        <Timer className="size-4" aria-hidden />
        计时器
        {!open && timer && <><span className="sr-only">，{status}，剩余</span><span className="font-mono tabular-nums">{time}</span></>}
      </span>
      {open && <ChevronDown className="size-4 text-muted-foreground" aria-hidden />}
    </Button>

    {open && <div id={panelId} className="w-72 max-w-full space-y-3 px-3 pb-3">
      <p className="text-center text-12 text-muted-foreground">当前卡片 {roomCount} 人在场</p>
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
              className="h-9 min-w-0 flex-1 rounded-control border border-border bg-background px-2 text-13 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            分钟
          </label>
          <Button type="submit" variant="primary" disabled={busy || !canStart}><Play className="size-4" aria-hidden />开始</Button>
        </div>
      </form>)}
      {canControl && timer && <div className="flex justify-center border-t border-border-subtle pt-1">
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void send({ action: "close" })}>结束计时</Button>
      </div>}
      {!canControl && <p className="text-12 text-muted-foreground">当前只能查看计时。</p>}
      {error && <p role="alert" className="text-12 text-destructive">{error}</p>}
    </div>}
  </div>;
}
