"use client";
import * as React from "react";
import { SlidersHorizontal, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { COMPOSER_STATUS } from "@/lib/mock/chat";
import { ComposerSettings } from "./composer-settings";

/**
 * 底部输入区（UC-8.2 R3 三）：上方常驻四段状态
 * （`Ava ＋3` · `skill：假设拆解` · `已引用 3 项上下文` · `输出到「假设树」`）+ `更多设置`。
 * 观察者无输入区（在 ChatMain 层用只读说明替代，不渲染本组件）。
 */
export function Composer({ invalid }: { invalid?: boolean }) {
  const [value, setValue] = React.useState("");
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const s = COMPOSER_STATUS;
  return (
    <div className="flex flex-col gap-2" data-testid="chat-composer">
      {/* 面板放在状态条**上方**：它编辑的就是状态条那四段，展开时不把输入区挤出视野 */}
      <ComposerSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <div className="flex flex-wrap items-center gap-1.5" data-testid="chat-composer-status">
        <Badge tone="ai">{s.agents}</Badge>
        <Badge tone="neutral">{s.skill}</Badge>
        <Badge tone="neutral">{s.context}</Badge>
        <Badge tone="outline">{s.output}</Badge>
        <Button
          size="xs"
          variant={settingsOpen ? "primary" : "ghost"}
          className="ml-auto"
          data-testid="chat-composer-settings"
          aria-expanded={settingsOpen}
          aria-controls="chat-settings-panel"
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <SlidersHorizontal aria-hidden className="h-3 w-3" />
          更多设置 {settingsOpen ? "▾" : "▸"}
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="向 AI 团队提问，或 @ 某个 agent 指定它回答"
          rows={2}
          data-testid="chat-composer-input"
          aria-invalid={invalid || undefined}
          className="flex-1"
        />
        <Button size="md" variant="primary" data-testid="chat-composer-send" disabled={invalid}>
          <SendHorizontal aria-hidden className="h-4 w-4" />
          发送
        </Button>
      </div>
    </div>
  );
}
