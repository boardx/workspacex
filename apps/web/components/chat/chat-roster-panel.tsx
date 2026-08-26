"use client";

import * as React from "react";
import Link from "next/link";
import { Store } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/chat/chat-error-state";
import type { CapabilityListing } from "@/lib/live-capabilities";
import type { GetAgentPanelOut } from "@/lib/live-chat";

/**
 * 本线程的 agent 编制面板（#467 / #619 / #728 D2）。
 *
 * ## 为什么在这里，而不是继续长在 `chat-read-screen.tsx` 里（issue #2052 / CK-P7）
 *
 * 这个组件原本是 `chat-read-screen.tsx`（项目线程读屏）的私有实现。CopilotKit v2 轨道
 * 的外壳（`copilotkit-v2-shell.tsx`）现在也要挂编制面板——#2025 当时把这件事延后，
 * 理由是「v2 的 threadId 是每次挂载的临时随机值，没有一条真实的 `chat_thread_agents`
 * 可以增删」，而 #2028 落地持久化线程之后这个前提已经不成立。
 *
 * 两条轨道各画一份编制面板 = 同一事实两处声明（本仓硬约束），所以原样搬到这里共用，
 * **视觉与全部 `data-testid` 逐字未变**（旧轨道的 e2e 锚点继续有效，本身就是没漂移的
 * 证据）。
 */

/**
 * ⚠ 写入口的渲染依据是 **`thread.mutate`**，因为契约里**没有** `roster.mutate` 这一档
 *   （`CHAT_WRITE_CAPABILITIES` 恰六个，见 `apps/api/src/domain/chat/thread-visibility.ts:276`）。
 *   服务端对编制的判定是 `role !== null && role !== "observer"`
 *   （`application/chat/update-agent-roster.ts` 的 `NO_WRITE_ROLE` 分支），与
 *   `thread.mutate` **同一个谓词** ⇒ 这里是**同源代理**，不是前端新造一份权限判断。
 *   缺一档专用能力已上报；服务端始终是权威（越权提交由 403 拒绝，见 API 测试）。
 *
 *   issue #2052 —— 个人线程（v2 轨道）走的是服务端那条豁免分支
 *   （`update-agent-roster.ts` 的 `isPersonalThread`，与 `land-as-artifact.ts`
 *   2026-08-21 人类裁决的同一条理由），`PERSONAL_THREAD_CAPABILITIES` 含
 *   `thread.mutate` ⇒ 这里的同源代理关系对个人线程同样成立，不需要第二套判断。
 */
export function RosterPanel({
  roster, loading, error, hasSelection, canMutate, pending, mutateFailure,
  candidates, candidatesError, onAdd, onRemove, onRetry,
}: {
  roster: GetAgentPanelOut | null;
  loading: boolean;
  error: string | null;
  hasSelection: boolean;
  canMutate: boolean;
  pending: boolean;
  mutateFailure: string | null;
  candidates: readonly CapabilityListing[];
  candidatesError: string | null;
  onAdd: (agentId: string) => void;
  onRemove: (agentId: string) => void;
  onRetry: () => void;
}) {
  const [draft, setDraft] = React.useState("");
  const writable = canMutate && hasSelection;

  const [addOpen, setAddOpen] = React.useState(false);

  // 换线程/候选列表变化时，之前选中的 id 可能已不再是合法候选（比如已被加进编制）。
  React.useEffect(() => {
    if (draft !== "" && !candidates.some((candidate) => candidate.id === draft)) setDraft("");
  }, [candidates, draft]);

  return (
    <div className="flex flex-col gap-2 px-3 pb-3" data-testid="chat-read-roster">
      {/* 栏头照原型：「本线程的 AI 团队 · N」。⚠ N 用的是 `rosterCount`（编制），
          在场数另写一行 —— 契约把两个计数刻意分离（I-18），糊成一个就说谎了。 */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <h2 className="text-11 font-medium text-muted-foreground">
          本线程的 AI 团队{roster ? ` · ${roster.rosterCount}` : ""}
          {roster && roster.presentCount !== roster.rosterCount
            ? ` · 在场 ${roster.presentCount}`
            : ""}
        </h2>
        {writable ? (
          <Button
            size="xs"
            variant="ghost"
            data-testid="chat-roster-edit"
            aria-expanded={addOpen}
            onClick={() => setAddOpen((open) => !open)}
          >
            编辑
          </Button>
        ) : (
          <span className="text-10 text-muted-foreground">只读</span>
        )}
      </div>

      {writable && addOpen ? (
        <form
          className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-card p-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft === "") return;
            onAdd(draft);
            setDraft("");
          }}
        >
          <label className="text-10 text-muted-foreground" htmlFor="chat-roster-add-input">
            加入 agent（选自组织 agent 目录）
          </label>
          <div className="flex items-center gap-2">
            <select
              id="chat-roster-add-input"
              data-testid="chat-roster-add-input"
              className="h-7 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-11 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={pending || candidates.length === 0}
            >
              <option value="">
                {candidates.length === 0 ? "组织 agent 目录里没有可加入的 agent" : "选择一个 agent…"}
              </option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}{candidate.abbr ? `（${candidate.abbr}）` : ""}
                </option>
              ))}
            </select>
            <Button size="xs" type="submit" data-testid="chat-roster-add-submit" disabled={pending || draft === ""}>
              {pending ? "提交中…" : "加入"}
            </Button>
          </div>
          {/* #619：候选来自 `GET /capabilities?kind=agent`（`org_agents` 收敛进
              `capability_listings` 之后，这就是"列出本线程可加的 agent"那个此前
              缺失的读端口），不再是自由文本框。
              ⚠ 原型的「从 Agent 市场加入」仍是另一个缺口：`marketEntry` 是服务端下发的
              可空入口，下发了才渲染，不自己造一个死链。 */}
          {/* #787 —— 诚实提示，纯 UI 措辞，不改数据流：
              这份候选列表读的是 `capability_listings`（目录），与实际执行读的
              `agents`/`agent_versions`（见 `resolvePublished`）不是同一张表。经后台
              目录页「+」（`POST /capabilities/mutate`）创建的 agent 只写
              `capability_listings`，不写 `agents`/`agent_versions`——加入编制之后
              发消息会 422 `AGENT_NOT_FOUND`（`AgentNotPublishedError`）。这是已知的
              后端数据模型裂痕（#787 记录在案，收敛方向待人类裁决），本处只如实
              告知，不假装能在这里修掉。 */}
          <p className="text-10 text-muted-foreground" data-testid="chat-roster-add-hint">
            候选来自组织 agent 目录，加入编制不代表该 agent 已具备可执行的运行时——如果加入后发消息失败，是已知的后台创建路径缺口，请联系管理员确认该 agent 是否已发布。
          </p>
          {candidatesError ? (
            <p className="text-10 text-destructive" data-testid="chat-roster-candidates-error">
              agent 目录读取失败：{candidatesError}
            </p>
          ) : null}
          {mutateFailure ? (
            <p className="text-10 text-destructive" data-testid="chat-roster-mutate-error">{mutateFailure}</p>
          ) : null}
        </form>
      ) : null}

      {/* issue #2075（TW-COPY-1）—— 「选择线程后读取…」这句在仓库里原有三份（产物/材料/编制）。
          只改 v2 那两份、留下这一份，正是本仓「同一事实两处声明」的样子：审计点名的这句话
          会在这里原样活着。三处一起换成用户语言 + 明确动作。
          ⚠ 本次合 main 时这份实现被 #2052 抽成了两条轨道共用的这个文件——改在这里，
             两条轨道自动同步，比原来那份私有副本更符合单一事实源。 */}
      {!hasSelection ? <p className="text-11 text-muted-foreground">还没有选择对话。在左侧选一条对话，这里会列出它的成员编制。</p> : null}
      {loading ? <p className="text-11 text-muted-foreground">正在读取编制…</p> : null}
      {error ? <ErrorState testId="chat-roster-error" message={error} retryTestId="chat-roster-retry" onRetry={onRetry} /> : null}

      {roster ? (
        <>
          {roster.agents.length === 0 ? (
            <p className="text-11 text-muted-foreground" data-testid="chat-roster-empty">当前编制为空。</p>
          ) : null}
          <ul className="flex flex-col">
            {roster.agents.map((agent) => (
              <li
                key={agent.id}
                className="flex items-start gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-muted"
                data-testid={`chat-roster-agent-${agent.id}`}
              >
                <Avatar initials={agent.abbr} tone="ai" size="sm" className="mt-0.5" />
                {/*
                  #728 D2 —— 名字与职责分两行，不再挤在同一个 `truncate` 里同归于尽。

                  ⚠ #1705（#728 D-1，人类裁决 2026-08-21）之前，契约的 `agents[].duty`
                    （`getAgentPanel.out`）是唯一一个描述性字段，原型这一区其实印了两件
                    事：角色（「战略分析师」）+ 一句能力描述（「拆问题、标致命假设、
                    给结论先行」），当时数据模型只有 `duty` 一个字段，不编一句话凑
                    第二行。#1705 加了 `agents[].roleLabel`（简短头衔，来自真实的
                    `agents` 表，不是 mock），第一行改渲染成「{name} · {roleLabel}」
                    照原型的头衔展示位；第二行仍是 `duty`（能力描述，与 `roleLabel`
                    是两个不同的字段，互不覆盖）。
                */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-12 font-medium">
                    {agent.name}
                    {agent.roleLabel ? <span className="text-muted-foreground"> · {agent.roleLabel}</span> : null}
                  </p>
                  <p className="truncate text-10 text-muted-foreground">{agent.duty}</p>
                </div>
                <span className={presenceTone(agent.presence)}>{PRESENCE_TEXT[agent.presence]}</span>
                {writable ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    data-testid={`chat-roster-remove-${agent.id}`}
                    disabled={pending}
                    onClick={() => onRemove(agent.id)}
                  >
                    移出
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {roster.marketEntry ? (
            <Button asChild size="xs" variant="outline" className="w-full">
              <Link href={roster.marketEntry} data-testid="chat-roster-market-entry">
                <Store aria-hidden className="h-3 w-3" />从 Agent 市场加入
              </Link>
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * 在场态的中文投影。契约的 `AgentPresence` 是三值封闭枚举（I-17），
 * 所以这里是**穷举的 Record 而不是带 default 的函数** —— 枚举加一档时 tsc 会红，
 * 而不是静默显示成一个英文单词。原型上印的是「在场 / 跑批中 / 空闲」，
 * 但契约三值是 present/away/off，语义并不一一对应：`away`≠「跑批中」。
 * 这里按契约语义翻译，**不**为了对上原型字面而编一个原型才有的状态。
 */
export const PRESENCE_TEXT: Record<GetAgentPanelOut["agents"][number]["presence"], string> = {
  present: "在场",
  away: "离开",
  off: "离线",
};

function presenceTone(presence: GetAgentPanelOut["agents"][number]["presence"]): string {
  return presence === "present" ? "text-10 text-primary" : "text-10 text-muted-foreground";
}

