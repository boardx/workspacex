"use client";
import * as React from "react";
import { TagInput } from "@/components/ui/tag-input";

/**
 * 模板库的标签输入器——2026-09-09 起只是 `components/ui/tag-input` 的薄封装。
 *
 * 本文件曾是**全仓最完整的那份**标签输入实现，另有三处各写各的（见共享组件头注）。
 * 人类指令「统一体验」之后，实现搬去共享组件，这里只保留模板库特有的那句用量文案
 * 与既有 `testIdPrefix` 默认值——**不复制实现**，否则又变回两份。
 *
 * `Design.pdf` §3.2 的判据没有任何放宽，仍由共享组件逐条满足。
 */
export function TemplateTagInput({
  value, onChange, knownTags, disabled = false, testIdPrefix = "tpladmin-tag",
}: {
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  /** `标签 → 有多少个模板在用`，由调用方从真实模板列表聚合。 */
  readonly knownTags: ReadonlyMap<string, number>;
  readonly disabled?: boolean;
  readonly testIdPrefix?: string;
}) {
  return (
    <TagInput
      value={value}
      onChange={onChange}
      knownTags={knownTags}
      noteFor={(n) => `${String(n)} 个模板在用`}
      disabled={disabled}
      testIdPrefix={testIdPrefix}
      emptyHint="输入即搜索已有标签，回车新建一个"
    />
  );
}
