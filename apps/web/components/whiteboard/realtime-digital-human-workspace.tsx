"use client";

import { useCallback, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";
import { Button } from "@/components/ui/button";
import { LiveBoard } from "./live-board";

export function RealtimeDigitalHumanWorkspace({ boardId }: { boardId: string }): JSX.Element {
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [speechEnabled, setSpeechEnabled] = useState(true);

  const speak = useCallback((text: string) => {
    if (!speechEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    window.speechSynthesis.speak(utterance);
  }, [speechEnabled]);

  const stopSpeech = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

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
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2 text-11 text-muted-foreground">
          <span>Board: {boardId}</span><span>已选 {selectedObjectIds.length} 个对象</span>
        </div>
        <div className="min-h-0 flex-1">
          <CopilotKitV2Panel
            realtimeContext={{ boardId, selectedObjectIds }}
            onAssistantText={speak}
          />
        </div>
        <div className="border-t border-border px-4 py-2">
          <Button size="sm" variant="ghost" className="w-full" onClick={stopSpeech}>只停止说话，任务继续</Button>
        </div>
      </aside>
    </div>
  );
}
