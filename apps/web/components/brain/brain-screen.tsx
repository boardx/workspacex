"use client";
import * as React from "react";
import { useSession } from "@/components/session/session-provider";
import { StateShell } from "@/components/state/state-shell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sessionTotals } from "@/lib/brain-view";
import { PersonalMemory } from "./personal-memory";
import { SessionMemory } from "./session-memory";
import { SharedLayers } from "./shared-layers";
import { useBrainData, type BrainData } from "./use-brain-data";

/**
 * 大脑（/brain）—— 只显示登录者自己的真实记忆（2026-09-24 人类指令「取消所有的 mockup 的数据」）。
 *
 *   · 我的长期记忆：个人空间里记下的每一条（按类型），每条能点回它出自的对话；
 *   · 对话里的记忆：每个记下了东西的对话一行计数，点进去就是那个对话的「记忆」页签；
 *   · 项目与组织：本阶段没有开放，如实说「尚未开放」，不摆示例数字。
 *
 * 数据来自 `GET /knowledge-graph/personal` 与 `GET /knowledge-graph/me/overview`，
 * 当前组织切换时重读。
 */
export function BrainScreen() {
  const { session } = useSession();
  if (!session) throw new Error("BrainScreen requires an authenticated session");
  const { state, reload } = useBrainData(session.currentOrgId);
  return <BrainView state={state} reload={reload} />;
}

/** 与取数分开，方便对每一种状态单独渲染（组件测试直接喂状态）。 */
export function BrainView({ state, reload }: { state: BrainData; reload: () => void }) {
  const [tab, setTab] = React.useState("personal");

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-5" data-testid="brain-screen">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-20 font-semibold tracking-tight">大脑</h1>
          <p className="text-12 text-muted-foreground">
            你在对话里让我记下的东西都在这里。长期记忆只有你自己看得到。
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={reload} disabled={state.status === "loading"} data-testid="brain-refresh">
          {state.status === "loading" ? "加载中…" : "刷新"}
        </Button>
      </header>

      {state.status === "loading" ? <StateShell state="loading" skeletonRows={5}>{null}</StateShell> : null}
      {state.status === "failed" ? (
        <StateShell
          state="dep-failed"
          depFailure={{ what: "暂时读不到你的记忆，请稍后再试。", retry: reload }}
        >
          {null}
        </StateShell>
      ) : null}
      {state.status === "denied" ? (
        <StateShell
          state="denied"
          denial={{ layer: "organization", reason: "你已不在当前组织里，看不到这里的记忆。可以切换到别的组织再看。" }}
        >
          {null}
        </StateShell>
      ) : null}

      {state.status === "ready" ? (
        <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4">
          <TabsList data-testid="brain-tabs">
            <TabsTrigger value="personal" data-testid="brain-tab-personal">
              我的长期记忆
              <span className="tabular-nums text-10 text-muted-foreground" data-testid="brain-tab-personal-count">
                {state.personal.claims.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="sessions" data-testid="brain-tab-sessions">
              对话里的记忆
              <span className="tabular-nums text-10 text-muted-foreground" data-testid="brain-tab-sessions-count">
                {sessionTotals(state.overview.threads).threads}
              </span>
            </TabsTrigger>
            <TabsTrigger value="shared" data-testid="brain-tab-shared">项目与组织</TabsTrigger>
          </TabsList>
          <TabsContent value="personal">
            <PersonalMemory personal={state.personal} origins={state.overview.personalOrigins} onShowSessions={() => setTab("sessions")} />
          </TabsContent>
          <TabsContent value="sessions">
            <SessionMemory threads={state.overview.threads} />
          </TabsContent>
          <TabsContent value="shared">
            <SharedLayers />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}
