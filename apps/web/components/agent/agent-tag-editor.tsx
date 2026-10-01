"use client";

/**
 * 数字人标签编辑器。2026-09-30 起输入与展示都走共享件（`TagInput` / `TagChip`），不再自带一套
 * 「chips + 输入框 + 添加按钮 + 预判提示」：回车/逗号确认、退格删最后一个、忽略大小写去重、
 * 超长/重复/已满都在输入框下方说一句人话。
 *
 * 规则单一事实源 = 契约 `agentRole.AgentTag` / `AGENT_TAGS_MAX`：上限与长度取自契约常量，
 * 服务端仍会按同一 schema 再校验一次。只读（`editable=false`）时只展示胶囊。
 */
import * as React from "react";
import { agentRole } from "@repo/contracts";
import { TagChip } from "@/components/ui/tag-chip";
import { TagInput, commitDraft } from "@/components/ui/tag-input";

const NO_KNOWN_TAGS: ReadonlyMap<string, number> = new Map();

export function AgentTagEditor({
  tags,
  editable,
  disabled,
  onChange,
  knownTags = NO_KNOWN_TAGS,
}: {
  readonly tags: readonly string[];
  readonly editable: boolean;
  readonly disabled: boolean;
  readonly onChange: (next: string[]) => void;
  /** 目录里已有的标签（`标签 → 用量`），给输入框做建议；不给就没有建议。 */
  readonly knownTags?: ReadonlyMap<string, number>;
}) {
  const [draft, setDraft] = React.useState("");
  const limits = { maxTags: agentRole.AGENT_TAGS_MAX, maxTagLength: agentRole.AGENT_TAG_MAX_LENGTH };

  return (
    <div
      className="flex flex-col gap-2"
      // 打完字没按回车就点别处（比如「保存」）：把草稿并进去，不丢
      onBlur={(e) => {
        if (!editable || e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        const next = commitDraft(tags, draft, limits);
        if (next.length !== tags.length) onChange([...next]);
        setDraft("");
      }}
    >
      <span className="text-11 text-muted-foreground">标签（如「销售」「调研」，用于目录和聊天里筛选数字人）</span>
      {editable ? (
        <TagInput
          value={tags}
          onChange={(next) => onChange([...next])}
          knownTags={knownTags}
          {...limits}
          disabled={disabled}
          draft={draft}
          onDraftChange={setDraft}
          testIdPrefix="agent-tag-editor"
          emptyHint="输入标签，回车确认"
        />
      ) : (
        <div data-testid="agent-tag-editor-chips" className="flex flex-wrap gap-1.5">
          {tags.length === 0 && <span className="text-12 text-muted-foreground">暂无标签</span>}
          {tags.map((tag) => (
            <TagChip key={tag} testId={`agent-tag-editor-chip-${tag}`}>{tag}</TagChip>
          ))}
        </div>
      )}
    </div>
  );
}
