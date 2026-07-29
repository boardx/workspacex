"use client";
import * as React from "react";
import { Search, Radio } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import {
  RIGHT_TABS,
  RIGHT_TABS_EMPTY,
  TRANSCRIPT_ENTRIES,
  TRANSCRIPT_SESSION,
  type RightTab,
  type TranscriptEntry,
} from "@/lib/mock/chat";

/**
 * 右侧上下文栏（UC-8.2 R3 四）：五标签 转录 / 执行 2/4 / 洞察 6 / 产物 3 / 材料 12，
 * 每个均带计数；默认落在转录页。头部「会议进行中 · 显示转录」+ `自动跟随` 开关 + 计时。
 * 空态（新线程）计数全为 0 且**不隐藏标签**（V14）。
 * 标签受控：转录里决策点的「看洞察」可直接切到洞察页。
 */
export function ChatRightPanel({ state = "default" }: { state?: UiState }) {
  const empty = state === "empty";
  const tabs = empty ? RIGHT_TABS_EMPTY : RIGHT_TABS;
  const [active, setActive] = React.useState("transcript");
  const [follow, setFollow] = React.useState(true);
  const [query, setQuery] = React.useState("");

  return (
    <div className="flex h-full flex-col" data-testid="chat-right-panel">
      {/* 头部：会议进行中 · 自动跟随 · 计时 */}
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <Radio aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-11 font-medium">{TRANSCRIPT_SESSION.status}</span>
        <span className="shrink-0 font-mono text-11 text-muted-foreground" data-testid="chat-transcript-timer">
          {empty ? "00:00" : TRANSCRIPT_SESSION.elapsed}
        </span>
      </div>

      <Tabs value={active} onValueChange={setActive} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="flex-wrap px-2 pt-2">
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key} data-testid={`chat-tab-${t.key}`}>
              {t.label}
              <TabCount tab={t} />
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <TabsContent value="transcript">
            {empty ? (
              <StateShell state="empty" emptyHint="现场还没有开始转录">
                <span />
              </StateShell>
            ) : (
              <TranscriptTab
                follow={follow}
                onFollowChange={setFollow}
                query={query}
                onQueryChange={setQuery}
                onSeeInsight={() => setActive("insight")}
              />
            )}
          </TabsContent>
          {["execution", "insight", "artifact", "material"].map((key) => (
            <TabsContent key={key} value={key}>
              <StateShell state={empty ? "empty" : "default"} emptyHint="本线程这一类还没有内容">
                <p className="text-12 text-muted-foreground" data-testid={`chat-tabpanel-${key}`}>
                  {tabLabel(tabs, key)}的列表在此按计数展开，与标签计数一致。
                </p>
              </StateShell>
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}

function TabCount({ tab }: { tab: RightTab }) {
  if (tab.countDisplay) return <span className="ml-1 text-10 text-muted-foreground">{tab.countDisplay}</span>;
  if (tab.count === null) return null;
  return <span className="ml-1 text-10 text-muted-foreground">{tab.count}</span>;
}

function tabLabel(tabs: RightTab[], key: string): string {
  return tabs.find((t) => t.key === key)?.label ?? key;
}

function TranscriptTab({
  follow, onFollowChange, query, onQueryChange, onSeeInsight,
}: {
  follow: boolean;
  onFollowChange: (v: boolean) => void;
  query: string;
  onQueryChange: (v: string) => void;
  onSeeInsight: () => void;
}) {
  const entries = query
    ? TRANSCRIPT_ENTRIES.filter((e) => e.text.includes(query) || e.speaker.includes(query))
    : TRANSCRIPT_ENTRIES;
  return (
    <div className="flex flex-col gap-2" data-testid="chat-transcript-tab">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="chat-follow" className="flex items-center gap-1.5 text-11 text-muted-foreground">
          <Toggle id="chat-follow" checked={follow} onCheckedChange={onFollowChange} label="自动跟随" />
          自动跟随
        </label>
      </div>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="搜索逐字稿"
          data-testid="chat-transcript-search"
          className="pl-7"
        />
      </div>
      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <TranscriptRow key={e.id} entry={e} onSeeInsight={onSeeInsight} />
        ))}
        {entries.length === 0 && (
          <li className="py-4 text-center text-11 text-muted-foreground">没有匹配「{query}」的逐字稿</li>
        )}
      </ul>
    </div>
  );
}

function TranscriptRow({ entry, onSeeInsight }: { entry: TranscriptEntry; onSeeInsight: () => void }) {
  return (
    <li className="flex flex-col gap-1" data-testid="chat-transcript-row">
      <div className="flex items-baseline gap-2">
        <span className="text-11 font-medium">{entry.speaker}</span>
        <span className="font-mono text-10 text-muted-foreground">{entry.time}</span>
        {entry.identifying && (
          <Badge tone="neutral" data-testid="chat-transcript-identifying">正在识别</Badge>
        )}
      </div>
      <p className="text-12 text-card-foreground">{entry.text}</p>
      {entry.decisionPoint && (
        <div className="flex items-center gap-2">
          <Badge tone="ai">Ava 标记为决策点</Badge>
          {/* 看洞察 → 切到本栏「洞察」页（受控标签，不跳出线程）*/}
          <Button size="xs" variant="ghost" onClick={onSeeInsight} data-testid="chat-transcript-insight">看洞察 ▸</Button>
        </div>
      )}
    </li>
  );
}
