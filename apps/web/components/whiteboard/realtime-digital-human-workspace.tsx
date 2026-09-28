"use client";

import { useCallback, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";
import { Button } from "@/components/ui/button";
import { LiveBoard } from "./live-board";

export function RealtimeDigitalHumanWorkspace({ boardId }: { boardId: string }): JSX.Element {
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [avatarState, setAvatarState] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");

  const speak = useCallback((text: string) => {
    if (!speechEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.onstart = () => setAvatarState("speaking");
    utterance.onend = () => setAvatarState("idle");
    utterance.onerror = () => setAvatarState("idle");
    window.speechSynthesis.speak(utterance);
  }, [speechEnabled]);

  const stopSpeech = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setAvatarState("idle");
  }, []);

  const stateLabel = { idle: "在线待命", listening: "正在聆听", thinking: "正在思考", speaking: "正在回答" }[avatarState];

  return (
    <div className="grid h-screen min-h-0 grid-cols-[minmax(0,1fr)_420px] bg-background">
      <div className="min-w-0"><LiveBoard boardId={boardId} onSelectionChange={setSelectedObjectIds} /></div>
      <aside className="flex min-h-0 flex-col border-l border-border bg-card" data-testid="realtime-digital-human-panel">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h1 className="text-14 font-semibold">实时数字人 POC</h1>
            <p className="text-11 text-muted-foreground">本地 ASR · Agent Runtime · 当前白板选区</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { stopSpeech(); setSpeechEnabled((value) => !value); }}
            aria-label={speechEnabled ? "关闭语音播报" : "开启语音播报"}
          >
            {speechEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
        </header>
        <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-primary/10 via-background to-background px-4 py-5" data-testid="digital-human-avatar" data-state={avatarState}>
          <div className="pointer-events-none absolute inset-x-8 top-7 h-28 rounded-full bg-primary/15 blur-3xl" />
          <div className="relative mx-auto flex w-fit flex-col items-center gap-3">
            <div className={`relative flex h-36 w-36 items-center justify-center rounded-full border border-primary/30 bg-card shadow-xl ${avatarState === "speaking" ? "animate-pulse" : ""}`}>
              <div className={`absolute inset-2 rounded-full border-2 border-primary/20 ${avatarState === "thinking" ? "animate-spin border-t-primary" : ""}`} />
              <svg viewBox="0 0 160 160" className="h-32 w-32" role="img" aria-label={`数字人 Avatar，${stateLabel}`}>
                <defs><linearGradient id="avatar-skin" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f8d9c5"/><stop offset="1" stopColor="#dcae96"/></linearGradient><linearGradient id="avatar-shirt" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#7c3aed"/><stop offset="1" stopColor="#2563eb"/></linearGradient></defs>
                <path d="M26 150c4-31 22-45 54-45s50 14 54 45" fill="url(#avatar-shirt)"/>
                <ellipse cx="80" cy="67" rx="42" ry="49" fill="url(#avatar-skin)"/>
                <path d="M39 65c-2-35 19-52 43-52 25 0 44 17 42 52-9-8-16-20-18-31-17 17-40 25-67 31Z" fill="#27272a"/>
                <g className={avatarState === "listening" ? "animate-pulse" : ""} fill="currentColor"><ellipse cx="63" cy="70" rx="4" ry="5"/><ellipse cx="97" cy="70" rx="4" ry="5"/></g>
                <path d="M69 91q11 9 22 0" fill="none" stroke="#9f4f55" strokeWidth="3" strokeLinecap="round"/>
                {avatarState === "speaking" ? <ellipse cx="80" cy="93" rx="9" ry="6" fill="#9f4f55" /> : null}
                <circle cx="119" cy="43" r="7" fill="#22c55e" stroke="white" strokeWidth="3"/>
              </svg>
              {avatarState === "speaking" ? <div className="absolute -bottom-2 flex h-8 items-center gap-1 rounded-full border bg-background px-3 shadow" aria-hidden>{[1,2,3,4,5].map((bar) => <span key={bar} className="w-1 animate-pulse rounded-full bg-primary" style={{ height: `${8 + (bar % 3) * 5}px`, animationDelay: `${bar * 90}ms` }} />)}</div> : null}
            </div>
            <div className="text-center"><p className="text-16 font-semibold">WorkspaceX 数字人</p><p className="mt-1 text-12 text-muted-foreground" role="status">{stateLabel}</p></div>
          </div>
        </section>
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2 text-11 text-muted-foreground">
          <span>Board: {boardId}</span><span>已选 {selectedObjectIds.length} 个对象</span>
        </div>
        <div className="min-h-0 flex-1">
          <CopilotKitV2Panel
            realtimeContext={{ boardId, selectedObjectIds }}
            onAssistantText={speak}
            onRunStateChange={({ isRunning }) => setAvatarState((current) => isRunning ? "thinking" : current === "thinking" ? "idle" : current)}
            onVoiceStateChange={(state) => setAvatarState(state)}
          />
        </div>
        <div className="border-t border-border px-4 py-2">
          <Button size="sm" variant="ghost" className="w-full" onClick={stopSpeech}>只停止说话，任务继续</Button>
        </div>
      </aside>
    </div>
  );
}
