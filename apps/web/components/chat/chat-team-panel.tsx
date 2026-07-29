"use client";
import * as React from "react";
import Link from "next/link";
import { UserPlus, Settings2, Check, Minus } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TEAM_AGENTS,
  TEAM_ROSTER_COUNT,
  AGENT_PRESENCE_LABEL,
  AGENT_PRESENCE_TONE,
} from "@/lib/mock/chat";

/**
 * AI 团队面板（客户端叶子）—— 从 `chat-left-panel`（服务端）里拆出交互部分。
 * 补两个死按钮：
 *  · `编制` → 切换本线程编制的**在编/移出**编辑模式（本地乐观：移出后 agent 变灰、计数减一）。
 *    编制是线程级人事，与「本轮调用设置」里的「谁来答」（单轮临时）不同——这里改的是常驻编制。
 *  · `从 Agent 市场加入` → 真链接到 Agent 市场（`/admin/agent`），不是死按钮。
 * ⚠ 界面投影：真实的编制变更由服务端落库，这里只做预览态的乐观反馈。
 */
export function ChatTeamPanel() {
  const [editing, setEditing] = React.useState(false);
  const [removed, setRemoved] = React.useState<string[]>([]);

  const rosterCount = TEAM_ROSTER_COUNT - removed.length;
  const toggleRemoved = (id: string) =>
    setRemoved((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <section className="flex flex-col gap-2 p-3" data-testid="chat-team-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-11 font-semibold text-background-foreground">
          本线程的 AI 团队 · {rosterCount}
        </h2>
        <Button
          variant={editing ? "primary" : "ghost"}
          size="xs"
          onClick={() => setEditing((v) => !v)}
          aria-pressed={editing}
          data-testid="chat-team-compose"
        >
          <Settings2 aria-hidden className="h-3 w-3" />
          {editing ? "完成编制" : "编制"}
        </Button>
      </div>

      {editing && (
        <p className="rounded-md bg-muted px-2 py-1 text-10 text-muted-foreground" data-testid="chat-team-edit-hint">
          编制 = 本线程常驻团队（与「本轮调用设置」里的单轮临时选人不同）。移出后本轮起不再自动到场，历史发言保留。
        </p>
      )}

      <ul className="flex flex-col gap-1">
        {TEAM_AGENTS.map((a) => {
          const isRemoved = removed.includes(a.id);
          return (
            <li
              key={a.id}
              data-testid={`chat-team-agent-${a.id}`}
              className="flex items-start gap-2 rounded-md px-1.5 py-1.5 transition-colors duration-200 hover:bg-muted"
            >
              <Avatar initials={a.initials} tone={isRemoved ? "muted" : "ai"} size="sm" className="mt-0.5" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center justify-between gap-1">
                  <span className={isRemoved ? "truncate text-12 font-medium text-muted-foreground line-through" : "truncate text-12 font-medium"}>
                    {a.name} · {a.role}
                  </span>
                  {editing ? (
                    <Button
                      variant={isRemoved ? "outline" : "ghost"}
                      size="xs"
                      onClick={() => toggleRemoved(a.id)}
                      aria-pressed={isRemoved}
                      data-testid={`chat-team-toggle-${a.id}`}
                    >
                      {isRemoved ? (
                        <>
                          <Check aria-hidden className="h-3 w-3" />
                          重新加入
                        </>
                      ) : (
                        <>
                          <Minus aria-hidden className="h-3 w-3" />
                          移出
                        </>
                      )}
                    </Button>
                  ) : (
                    <Badge tone={AGENT_PRESENCE_TONE[a.presence]} data-testid={`chat-team-presence-${a.id}`}>
                      {AGENT_PRESENCE_LABEL[a.presence]}
                    </Badge>
                  )}
                </div>
                <p className="text-10 text-muted-foreground">{a.duty}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <Button variant="ghost" size="xs" className="justify-start text-muted-foreground" asChild data-testid="chat-team-market">
        <Link href="/admin/agent">
          <UserPlus aria-hidden className="h-3.5 w-3.5" />
          从 Agent 市场加入
        </Link>
      </Button>
    </section>
  );
}
