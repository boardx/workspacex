"use client";
import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { Identity } from "@/lib/identity";
import {
  REC_SCREENS, REC_SCREEN_LABEL, REC_SCREEN_UC, CARRIERS, CARRIER_LABEL,
  REC_VIEWS_BY_CARRIER, RIGHT_TABS,
  type RecScreen, type Carrier, type RecView,
} from "@/lib/mock/rec";
import { RightRailNav } from "./right-rail";
import { RecPrep } from "./rec-prep";
import { RecProcess } from "./rec-process";
import { RecVerify } from "./rec-verify";
import { LiveTranscript } from "./live-transcript";
import { SpeakerAssign } from "./speaker-assign";
import { QuoteAnnotate } from "./quote-annotate";
import { RetentionPanel } from "./retention-panel";

/**
 * `rec`（录音与转写）能力域编排 —— 三载体共享一套转写能力（UC-5.1 R1）。
 *
 * 复用已确认的三栏骨架 AppShell：左栏来源/载体导航、中栏主内容、右栏五标签（转录/执行/洞察/产物/材料）。
 * `screen`/`carrier`/`state`/`as` 走 URL 做预览切换；屏内选择、指派、勾选走本地状态。
 * ⚠ 视角切换是**预览手段**，真实权限在服务端 RLS——这里的 `?as=` 只改本地展示。
 */
export function RecApp({
  identity, uiState, screen, carrier, view, qs,
}: {
  identity: Identity;
  uiState: UiState;
  screen: RecScreen;
  carrier: Carrier;
  view: RecView;
  qs: { as?: string; carrier?: string; org?: string };
}) {
  const href = (o: Partial<{ as: string; state: string; screen: string; carrier: string }>) => {
    const p = new URLSearchParams();
    const as = o.as ?? qs.as; if (as) p.set("as", as);
    if (qs.org) p.set("org", qs.org);
    const st = o.state ?? uiState; if (st && st !== "default") p.set("state", st);
    const sc = o.screen ?? screen; if (sc && sc !== "live") p.set("screen", sc);
    const ca = o.carrier ?? carrier; if (ca && ca !== "interview") p.set("carrier", ca);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };

  return (
    <AppShell
      identity={identity}
      previewRole={identity.projectRole}
      left={<LeftNav screen={screen} carrier={carrier} href={href} />}
      right={<RightRailNav />}
    >
      <div className="flex h-full min-h-0 flex-col">
        <PreviewControls href={href} screen={screen} carrier={carrier} uiState={uiState} qs={qs} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {screen === "prep" && <RecPrep state={uiState} view={view} />}
          {screen === "process" && <RecProcess state={uiState} view={view} />}
          {screen === "verify" && <RecVerify state={uiState} view={view} />}
          {screen === "live" && <LiveTranscript state={uiState} carrier={carrier} view={view} />}
          {screen === "assign" && <SpeakerAssign state={uiState} view={view} />}
          {screen === "annotate" && <QuoteAnnotate state={uiState} view={view} />}
          {screen === "retention" && <RetentionPanel state={uiState} view={view} />}
        </div>
      </div>
    </AppShell>
  );
}

/* ── 左栏：载体导航 + 屏导航（沿用左侧语义分段心智）──────────────────── */

function LeftNav({
  screen, carrier, href,
}: {
  screen: RecScreen;
  carrier: Carrier;
  href: (o: Partial<{ screen: string; carrier: string }>) => string;
}) {
  return (
    <nav className="flex flex-col gap-4 p-3" data-testid="rec-left-nav">
      <div className="flex flex-col gap-1.5">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">录制载体</span>
        {CARRIERS.map((c) => (
          <Button
            key={c}
            asChild
            size="sm"
            variant={c === carrier ? "primary" : "ghost"}
            className="justify-start"
            data-testid={`rec-carrier-${c}`}
          >
            <a href={href({ carrier: c })}>{CARRIER_LABEL[c]}</a>
          </Button>
        ))}
        <p className="px-1 pt-1 text-9 text-muted-foreground">
          三载体共享同一套转写段与时间码模型（source_type ∈ workshop / interview / thread）。
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">录音与转写</span>
        {REC_SCREENS.map((s) => (
          <Button
            key={s}
            asChild
            size="sm"
            variant={s === screen ? "primary" : "ghost"}
            className="h-auto flex-col items-start gap-0.5 py-1.5"
            data-testid={`rec-nav-${s}`}
          >
            <a href={href({ screen: s })}>
              <span className="text-12">{REC_SCREEN_LABEL[s]}</span>
              <span className="text-9 text-muted-foreground">{REC_SCREEN_UC[s]}</span>
            </a>
          </Button>
        ))}
      </div>
    </nav>
  );
}

/* ── 预览控制条（屏 / 载体 / 视角 / 七态；仅开发，生产不渲染）──────────── */

function PreviewControls({
  href, screen, carrier, uiState, qs,
}: {
  href: (o: Partial<{ as: string; state: string; screen: string; carrier: string }>) => string;
  screen: RecScreen;
  carrier: Carrier;
  uiState: UiState;
  qs: { as?: string; carrier?: string; org?: string };
}) {
  if (process.env.NODE_ENV === "production") return null;
  const currentAs = qs.as ?? "facilitator";
  return (
    <div className="flex flex-col gap-1.5 border-b border-border-subtle bg-panel-alt px-3 py-2" data-testid="rec-preview-controls">
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">屏</span>
        {REC_SCREENS.map((s) => (
          <Button key={s} asChild size="xs" variant={s === screen ? "primary" : "ghost"} data-testid="rec-screen-switch">
            <a href={href({ screen: s })}>{REC_SCREEN_LABEL[s]}</a>
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">载体</span>
        {CARRIERS.map((c) => (
          <Button key={c} asChild size="xs" variant={c === carrier ? "primary" : "ghost"} data-testid="rec-carrier-switch">
            <a href={href({ carrier: c })}>{CARRIER_LABEL[c]}</a>
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">
          视角 · {CARRIER_LABEL[carrier]}词表
        </span>
        {REC_VIEWS_BY_CARRIER[carrier].map((r) => (
          <Button key={r.id} asChild size="xs" variant={currentAs === r.id ? "primary" : "ghost"} data-testid="rec-role-switch">
            <a href={href({ as: r.id })} title={r.note}>{r.label}</a>
          </Button>
        ))}
        <Badge tone="outline" className="ml-1">预览手段 · 真实权限在服务端 RLS</Badge>
      </div>
      <StatePreviewSwitcher current={uiState} />
    </div>
  );
}

export { RIGHT_TABS };
