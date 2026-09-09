"use client";
import { SkillMultiFileEditor } from "./skill-multi-file-editor";
import type { CapabilityListing } from "@/lib/live-capabilities";
/** Real model-A Skill editor; all edits become one immutable published version. */
export function SkillContentEditorSection({ id, row }: { id: string; row: CapabilityListing }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-2 border-t border-border-subtle pt-2">
    <details className="text-11 text-muted-foreground" data-testid={`${id}-content-hint`}><summary className="cursor-pointer">内容（文件树 / 代码）</summary><p>新建、修改、删除先保留在本页；确认后统一保存并发布新版本。已有 Agent 固定版本保持原样。</p></details>
    <div className="flex min-h-0 flex-1 flex-col" data-testid={`${id}-content-editor`}><SkillMultiFileEditor key={row.id} skillId={row.id} /></div>
  </div>;
}
