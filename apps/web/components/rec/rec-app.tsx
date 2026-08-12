"use client";

import { AppShell } from "@/components/shell/app-shell";
import type { Identity } from "@/lib/identity";
import type { UiState } from "@/lib/ui-state";
import type { Carrier, RecScreen, RecView } from "@/lib/mock/rec";
import { TranscriptionHistory } from "./transcription-history";
import { RecPrep } from "./rec-prep";
import { RecProcess } from "./rec-process";
import { RecVerify } from "./rec-verify";
import { LiveTranscript } from "./live-transcript";
import { SpeakerAssign } from "./speaker-assign";
import { QuoteAnnotate } from "./quote-annotate";
import { RetentionPanel } from "./retention-panel";

/**
 * `/rec` 的 UI-first 工作台。
 *
 * 当前阶段只使用本地 mock 数据验证历史卡片与创建弹窗；后续 feature 会复用本组件，
 * 将列表、创建动作和实时会话分别接到受保护的 BoardX API 与 WebSocket。
 */
export function RecApp({
  identity, uiState, screen, carrier, view, qs,
}: {
  identity: Identity;
  uiState: UiState;
  screen: RecScreen;
  carrier: Carrier;
  view: RecView;
  qs: { as?: string; carrier?: string; org?: string; mode?: string };
}) {
  if (qs.mode === "project") {
    return (
      <AppShell identity={identity} previewRole={identity.projectRole}>
        <div className="h-full min-h-0 overflow-y-auto">
          {screen === "prep" && <RecPrep state={uiState} view={view} />}
          {screen === "process" && <RecProcess state={uiState} view={view} />}
          {screen === "verify" && <RecVerify state={uiState} view={view} />}
          {screen === "live" && <LiveTranscript state={uiState} carrier={carrier} view={view} />}
          {screen === "assign" && <SpeakerAssign state={uiState} view={view} />}
          {screen === "annotate" && <QuoteAnnotate state={uiState} view={view} />}
          {screen === "retention" && <RetentionPanel state={uiState} view={view} />}
        </div>
      </AppShell>
    );
  }
  return (
    <AppShell previewRole={null} hideRoleSwitcher hideTopBar>
      <TranscriptionHistory uiState={uiState} />
    </AppShell>
  );
}
