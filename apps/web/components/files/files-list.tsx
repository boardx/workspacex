"use client";
import * as React from "react";
import { ChevronRight, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  SOURCE_ICON, IngestBadge, SynthesizedBadge, ConfidentialBadge, IntegrityBadge,
} from "./status";
import {
  type FileItem, VISIBILITY_LABEL, AGENDA_SEGMENTS, UNSEGMENTED, formatBytes,
} from "@/lib/mock/files";

/**
 * 中列表 —— 十列（UC-22.1 R3 第 3 步）：名称 / 来源类型 / 大小 / 版本 / 时间 /
 * 上传者 / 所属环节 / 可见性 / 机密标记 / 摄取状态。默认全显。
 * 行选择 → 顶部批量操作条（在 files-app 里）。非 READY 行的状态显式可见。
 */
const SEG_NAME = (id: string) =>
  id === UNSEGMENTED.id ? "—" : AGENDA_SEGMENTS.find((s) => s.id === id)?.name.replace(/^环节 \d+ · /, "") ?? "—";

export function FilesList({
  files, selectedId, checkedIds, onRow, onToggleCheck, onOpenVersions,
}: {
  files: FileItem[];
  selectedId: string | null;
  checkedIds: Set<string>;
  onRow: (f: FileItem) => void;
  onToggleCheck: (id: string) => void;
  onOpenVersions: (f: FileItem) => void;
}) {
  return (
    // ⚠ 这是一张 min-w-[52rem] 的多列表（名称/来源/状态/版本/大小/时间/动作），
    //   窄屏下横滚是**设计**而非缺陷——列砍掉会丢信息，换成卡片流会丢可比性。
    //   `data-allow-x-scroll` 是给响应式门控（e2e/responsive.spec.ts）的显式声明：
    //   意图要写出来，不该让门控从 computed style 去猜。
    <div
      className="overflow-x-auto"
      data-testid="files-list"
      data-allow-x-scroll="文件表 7 列，窄屏横滚看全；砍列会丢信息"
    >
      <Table className="w-full min-w-[52rem] border-collapse text-12">
        <TableHeader>
          <TableRow className="border-b border-border text-left text-11 text-muted-foreground">
            <TableHead className="w-8 px-2 py-2" />
            <TableHead className="px-2 py-2 font-medium">名称</TableHead>
            <TableHead className="px-2 py-2 font-medium">大小</TableHead>
            <TableHead className="px-2 py-2 font-medium">版本</TableHead>
            <TableHead className="px-2 py-2 font-medium">时间</TableHead>
            <TableHead className="px-2 py-2 font-medium">上传者</TableHead>
            <TableHead className="px-2 py-2 font-medium">所属环节</TableHead>
            <TableHead className="px-2 py-2 font-medium">可见性</TableHead>
            <TableHead className="px-2 py-2 font-medium">状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((f) => {
            const Icon = SOURCE_ICON[f.sourceType];
            const active = f.id === selectedId;
            return (
              <TableRow
                key={f.id}
                data-testid="files-row"
                onClick={() => onRow(f)}
                className={cn(
                  "cursor-pointer border-b border-border-subtle transition-colors duration-200",
                  active ? "bg-muted" : "hover:bg-panel",
                )}
              >
                <TableCell className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={checkedIds.has(f.id)}
                    onChange={() => onToggleCheck(f.id)}
                    aria-label="选择此行"
                    data-testid="files-row-check"
                  />
                </TableCell>
                <TableCell className="max-w-[18rem] px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium" title={f.name}>{f.name}.{f.ext}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 pl-6">
                    {f.confidential && <ConfidentialBadge />}
                    {f.synthesized && <SynthesizedBadge />}
                    {f.integrity === "failed" && <IntegrityBadge />}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">{formatBytes(f.sizeBytes)}</TableCell>
                <TableCell className="px-2 py-1.5">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onOpenVersions(f); }}
                    data-testid="files-row-version"
                    className="inline-flex items-center gap-0.5 rounded-sm px-1 text-primary transition-all duration-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    v{f.versionCount} <ChevronRight aria-hidden className="h-3 w-3" />
                  </button>
                </TableCell>
                <TableCell className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{f.createdAt}</TableCell>
                <TableCell className="whitespace-nowrap px-2 py-1.5">
                  {f.uploader.type === "agent" ? (
                    <span className="inline-flex items-center gap-1 text-ai-tint-foreground" title={`agent_run_id: ${f.uploader.agentRunId}`} data-testid="files-row-agent">
                      <Bot aria-hidden className="h-3 w-3" /> {f.uploader.name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{f.uploader.name}</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{SEG_NAME(f.segmentId)}</TableCell>
                <TableCell className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{VISIBILITY_LABEL[f.visibility]}</TableCell>
                <TableCell className="px-2 py-1.5"><IngestBadge state={f.ingest} /></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
