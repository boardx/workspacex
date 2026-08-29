"use client";

import * as React from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CapabilityListing, VisibilityScope } from "@/lib/live-capabilities";

/**
 * 「从 Agent 市场加入」弹窗（人类原话，2026-08-29：「从市场导入应该改为弹出一个新的
 * 对话框，让我通过 tags 来过滤或文字搜索浏览 agent，然后加入讨论」）。
 *
 * ## 为什么过滤维度只有「可见范围」一个 chip，没有自由 tags
 *
 * 同 `skill-catalog-live.tsx` 2026-08-13 那次「需要 tags 用来过滤」的先例
 * （见该文件 36-49 行注释）：契约 `CapabilityListing`（`packages/contracts/src/
 * identity.ts:358`）**没有 tag/category 字段**，候选列表（`RosterPanelProps.candidates`）
 * 本身也已经被上游过滤到「同组织、已启用、尚未在编制里的 agent」（见
 * `copilotkit-v2-shell.tsx` 的 `agentCandidates`），除 `name`/`abbr`/`duty`
 * （文字搜索用）之外，剩下唯一的封闭枚举就是 `scope`（全组织可见 / 仅团队可见）。
 * 这里用它当过滤 chip——它本来就是后端真实字段，语义上就是一种「标签」，而不是
 * 在前端发明一个不存在的 tags 概念给用户看。自由文本 tags 需要新增契约字段
 * （同 `20260814090000_g5_skill_contract_tags.sql` 的先例），是另一个契约面，
 * 不在本次改动范围内。
 *
 * 弹窗本身零网络请求：候选列表复用 `RosterPanel` 已经在读的同一份
 * `candidates`（`GET /capabilities?kind=agent`），过滤纯前端本地做。
 */

const SCOPE_CHIPS: readonly { value: VisibilityScope; label: string; slug: string }[] = [
  { value: "org-wide", label: "全组织可见", slug: "org-wide" },
  { value: "team-only", label: "仅团队可见", slug: "team-only" },
];

function matchesQuery(candidate: CapabilityListing, query: string): boolean {
  if (query.trim() === "") return true;
  const needle = query.trim().toLowerCase();
  return [candidate.name, candidate.abbr, candidate.duty]
    .some((field) => field !== null && field.toLowerCase().includes(needle));
}

export interface AgentMarketDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly candidates: readonly CapabilityListing[];
  readonly candidatesError: string | null;
  readonly pending: boolean;
  readonly mutateFailure: string | null;
  /** 后台完整 Agent 目录的落点（服务端下发，`null` 时不渲染这个二级入口）。 */
  readonly marketEntry: string | null;
  readonly onAdd: (agentId: string) => void;
}

export function AgentMarketDialog({
  open, onOpenChange, candidates, candidatesError, pending, mutateFailure, marketEntry, onAdd,
}: AgentMarketDialogProps) {
  const [query, setQuery] = React.useState("");
  const [scopeFilter, setScopeFilter] = React.useState<ReadonlySet<VisibilityScope>>(new Set());

  // 每次打开都从空过滤态开始——上一次浏览时留下的搜索词/chip 选择对这一次会话
  // 没有意义，留着只会让人以为「怎么搜出来是空的」。
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setScopeFilter(new Set());
    }
  }, [open]);

  function toggleScope(value: VisibilityScope) {
    setScopeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  const filtered = candidates.filter((candidate) => {
    if (scopeFilter.size > 0 && !scopeFilter.has(candidate.scope)) return false;
    return matchesQuery(candidate, query);
  });
  const filterActive = query.trim() !== "" || scopeFilter.size > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto" data-testid="chat-agent-market-dialog">
        <DialogHeader>
          <DialogTitle>从 Agent 市场加入</DialogTitle>
          <DialogDescription>按标签过滤或搜索文字，浏览组织 agent 目录，加入本线程的讨论。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 agent 名称或职责…"
              className="pl-8"
              data-testid="chat-agent-market-search"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="px-1 text-9 uppercase tracking-wide text-muted-foreground">按标签过滤</span>
            {SCOPE_CHIPS.map((chip) => {
              const isSelected = scopeFilter.has(chip.value);
              return (
                <Button
                  key={chip.value}
                  size="xs"
                  variant={isSelected ? "primary" : "outline"}
                  aria-pressed={isSelected}
                  onClick={() => toggleScope(chip.value)}
                  data-testid={`chat-agent-market-tag-${chip.slug}`}
                >
                  {chip.label}
                </Button>
              );
            })}
            {filterActive ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => { setQuery(""); setScopeFilter(new Set()); }}
                data-testid="chat-agent-market-clear"
              >
                清除过滤
              </Button>
            ) : null}
          </div>
        </div>

        {candidatesError ? (
          <p className="text-11 text-destructive" data-testid="chat-agent-market-candidates-error">
            agent 目录读取失败：{candidatesError}
          </p>
        ) : null}
        {mutateFailure ? (
          <p className="text-11 text-destructive" data-testid="chat-agent-market-mutate-error">{mutateFailure}</p>
        ) : null}

        {candidates.length === 0 ? (
          <p className="py-6 text-center text-12 text-muted-foreground" data-testid="chat-agent-market-empty">
            组织 agent 目录里没有可加入的 agent。
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-12 text-muted-foreground" data-testid="chat-agent-market-no-match">
            没有 agent 匹配当前的搜索词或标签。
          </p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="chat-agent-market-list">
            {filtered.map((candidate) => (
              <li
                key={candidate.id}
                className="flex items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-muted"
                data-testid={`chat-agent-market-row-${candidate.id}`}
              >
                <Avatar initials={candidate.abbr ?? candidate.name.slice(0, 2)} tone="ai" size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-12 font-medium">{candidate.name}</p>
                  {candidate.duty ? <p className="truncate text-10 text-muted-foreground">{candidate.duty}</p> : null}
                </div>
                <Button
                  size="xs"
                  disabled={pending}
                  onClick={() => onAdd(candidate.id)}
                  data-testid={`chat-agent-market-add-${candidate.id}`}
                >
                  {pending ? "加入中…" : "加入"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {marketEntry ? (
          <Button asChild size="xs" variant="ghost" className="self-start" data-testid="chat-agent-market-admin-link">
            <Link href={marketEntry}>在后台管理完整 Agent 目录</Link>
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
