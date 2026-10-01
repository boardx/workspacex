"use client";

/**
 * 数字人标签编辑器（chips：回车/「添加」加一个，× 移除）。
 *
 * 规则单一事实源 = 契约 `agentRole.AgentTag` / `AGENT_TAGS_MAX`：本组件只在提交前用同一份
 * schema 预判，给出人话提示（空白、超长、重复、已满），服务端仍会按同一 schema 再校验一次。
 */
import * as React from "react";
import { agentRole } from "@repo/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function tagInputProblem(raw: string, current: readonly string[]): string | null {
  const tag = raw.trim();
  if (tag.length === 0) return "请输入标签内容";
  if (!agentRole.AgentTag.safeParse(tag).success) return `标签最多 ${agentRole.AGENT_TAG_MAX_LENGTH} 个字`;
  if (current.includes(tag)) return "这个标签已经有了";
  if (current.length >= agentRole.AGENT_TAGS_MAX) return `最多 ${agentRole.AGENT_TAGS_MAX} 个标签`;
  return null;
}

export function AgentTagEditor({
  tags,
  editable,
  disabled,
  onChange,
}: {
  readonly tags: readonly string[];
  readonly editable: boolean;
  readonly disabled: boolean;
  readonly onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = React.useState("");
  const [hint, setHint] = React.useState<string | null>(null);

  const add = () => {
    const problem = tagInputProblem(draft, tags);
    if (problem !== null) {
      setHint(problem);
      return;
    }
    setHint(null);
    setDraft("");
    onChange([...tags, draft.trim()]);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-11 text-muted-foreground">标签（如「销售」「调研」，用于目录和聊天里筛选数字人）</span>
      <div data-testid="agent-tag-editor-chips" className="flex flex-wrap gap-1.5">
        {tags.length === 0 && <span className="text-12 text-muted-foreground">暂无标签</span>}
        {tags.map((tag) => (
          <Badge key={tag} tone="neutral" data-testid={`agent-tag-editor-chip-${tag}`}>
            {tag}
            {editable && (
              <button
                type="button"
                aria-label={`移除标签 ${tag}`}
                className="ml-1"
                disabled={disabled}
                onClick={() => onChange(tags.filter((t) => t !== tag))}
              >
                ×
              </button>
            )}
          </Badge>
        ))}
      </div>
      {editable && (
        <div className="flex items-center gap-2">
          <Input
            data-testid="agent-tag-editor-input"
            aria-label="新标签"
            placeholder="输入标签后回车"
            value={draft}
            disabled={disabled}
            onChange={(e) => { setDraft(e.target.value); setHint(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className="w-40"
          />
          <Button data-testid="agent-tag-editor-add" size="sm" variant="secondary" disabled={disabled} onClick={add}>
            添加
          </Button>
        </div>
      )}
      {hint !== null && <p data-testid="agent-tag-editor-hint" className="text-12 text-destructive">{hint}</p>}
    </div>
  );
}
