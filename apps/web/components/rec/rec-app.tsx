"use client";

import { AppShell } from "@/components/shell/app-shell";
import type { Identity } from "@/lib/identity";
import type { UiState } from "@/lib/ui-state";
import type { Carrier, RecScreen, RecView } from "@/lib/mock/rec";
import { TranscriptionHistory } from "./transcription-history";

/**
 * `/rec` 的 UI-first 工作台。
 *
 * 当前阶段只使用本地 mock 数据验证历史卡片与创建弹窗；后续 feature 会复用本组件，
 * 将列表、创建动作和实时会话分别接到受保护的 BoardX API 与 WebSocket。
 */
export function RecApp({
  identity, uiState,
}: {
  identity: Identity;
  uiState: UiState;
  screen: RecScreen;
  carrier: Carrier;
  view: RecView;
  qs: { as?: string; carrier?: string; org?: string };
}) {
  return (
    <AppShell identity={identity} previewRole={identity.projectRole} hideRoleSwitcher hideTopBar>
      <TranscriptionHistory uiState={uiState} />
    </AppShell>
  );
}
