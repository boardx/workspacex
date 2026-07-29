"use client";
import * as React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { BrainOverview } from "./overview";
import { PrivateLayer, OrgLayer } from "./layers";
import { DecisionLedger } from "./decision-ledger";
import { ContextPackPanel } from "./context-pack";
import { LEDGER_HEADER } from "@/lib/mock/brain";

const TABS = [
  { key: "overview", label: "三层关系总览" },
  { key: "private", label: "私有" },
  { key: "org", label: "组织大脑" },
  { key: "ledger", label: `决策台账 ${LEDGER_HEADER.awaitingSign}` },
  { key: "context", label: "AI 读到了什么" },
] as const;

export function BrainWorkbench({ state }: { state: UiState }) {
  // 受控标签：总览页的「打开决策台账」可直接切到 ledger 页
  const [tab, setTab] = React.useState("overview");

  return (
    <div className="flex flex-col gap-4 p-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-20 font-semibold tracking-tight">组织大脑</h1>
        <p className="text-12 text-muted-foreground">
          个人 / 项目 / 组织三层记忆。晋升有门槛，引用可审查，过期会提示。
        </p>
      </header>

      <StateShell
        state={state}
        emptyHint="组织大脑还没有生效条目：先在项目里沉淀一个被签字的决策"
        onCreate={() => window.alert("演示：去项目沉淀")}
        errors={{ ttl: "该条目有效期已过且未复核，引用前请先复核或标记为待复核" }}
        depFailure={{
          what: "组织层检索服务暂时不可用；已降级为「仅项目图谱 + 当前转录」，绝不静默用空上下文回答",
          retry: () => window.location.reload(),
        }}
        denial={{ layer: "organization", reason: "观察者/客户不可见检索记录与私有层，仅见已发布产物上的脱敏来源角标" }}
        successMessage="已固定这段上下文到本项目"
        skeletonRows={6}
      >
        <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4">
          <TabsList data-testid="brain-tabs">
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} data-testid={`brain-tab-${t.key}`}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview"><BrainOverview onNavigate={setTab} /></TabsContent>
          <TabsContent value="private"><PrivateLayer /></TabsContent>
          <TabsContent value="org"><OrgLayer /></TabsContent>
          <TabsContent value="ledger"><DecisionLedger /></TabsContent>
          <TabsContent value="context"><ContextPackPanel /></TabsContent>
        </Tabs>
      </StateShell>
    </div>
  );
}
