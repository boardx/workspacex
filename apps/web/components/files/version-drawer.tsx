"use client";
import * as React from "react";
import { Download, Copy, GitBranch, Bot, CornerDownRight, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Drawer } from "./overlay";
import { type FileItem, formatBytes } from "@/lib/mock/files";

/**
 * 版本列表 + 派生物（UC-22.4 R3.a/b 的下钻层，不是独立页面）。
 * 逐版：版本号 / 时间 / 创建者（人或 agent）/ 字节 / **SHA-256 可复制** / 变更来源 / **每版独立下载**。
 * 🔴 旧版仍可下载 —— 证据平面不可变性的用户可见形式。
 * 派生物是原件下的子节点，带 derived_from → 具体 version_id，且不覆盖原件。
 */
export function VersionDrawer({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const versions = file.versions ?? [
    { version: file.versionCount, createdAt: file.createdAt, by: file.uploader, sizeBytes: file.sizeBytes, sha256: file.sha256, changeSource: "上传" as const, current: true },
  ];

  return (
    <Drawer
      testid="files-version-drawer"
      title={`版本历史 · ${file.name}.${file.ext}`}
      subtitle="原件写入后永不覆盖，更新走新版本；引用指向具体 version_id，历史结论的证据不会被偷换。"
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <Button size="sm" variant="outline" className="self-start" data-testid="files-version-upload-new">
          <UploadCloud aria-hidden className="h-3.5 w-3.5" /> 上传新版本
        </Button>

        <div className="flex flex-col gap-2">
          {versions.slice().reverse().map((v) => (
            <div
              key={v.version}
              data-testid="files-version-row"
              className={cn("flex flex-col gap-1.5 rounded-lg border p-3", v.current ? "border-primary bg-panel" : "border-border")}
            >
              <div className="flex items-center gap-2">
                <GitBranch aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-13 font-semibold">v{v.version}</span>
                {v.current && <Badge tone="primary" data-testid="files-version-current">当前版本</Badge>}
                <Badge tone="outline">{v.changeSource}</Badge>
                <span className="ml-auto text-11 tabular-nums text-muted-foreground">{formatBytes(v.sizeBytes)}</span>
              </div>
              <p className="text-11 text-muted-foreground">
                {v.createdAt} ·{" "}
                {v.by.type === "agent"
                  ? <span className="inline-flex items-center gap-1 text-ai-tint-foreground"><Bot aria-hidden className="h-3 w-3" />{v.by.name}</span>
                  : v.by.name}
              </p>
              <div className="flex items-center gap-1.5">
                <code className="min-w-0 flex-1 truncate rounded-sm bg-muted px-1.5 py-0.5 font-mono text-11" title={v.sha256}>{v.sha256}</code>
                <Button size="xs" variant="ghost" aria-label="复制 SHA-256" data-testid="files-version-copy-sha"><Copy aria-hidden className="h-3 w-3" /></Button>
                <Button size="xs" variant="outline" data-testid="files-version-download"><Download aria-hidden className="h-3 w-3" /> 下载</Button>
              </div>
            </div>
          ))}
        </div>

        {file.derived && file.derived.length > 0 && (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <p className="text-11 font-medium text-muted-foreground">派生物（原件的子节点 · 不覆盖原件 · 各带 derived_from）</p>
              {file.derived.map((d) => (
                <div key={d.name} className="flex items-start gap-2 rounded-md border border-border-subtle bg-panel p-2" data-testid="files-derived-row">
                  <CornerDownRight aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-12 font-medium">{d.name}</p>
                    <p className="text-11 text-muted-foreground">
                      derived_from v{d.derivedFromVersion} · {d.generatorModel} {d.generatorVersion} ·{" "}
                      {d.kind === "embedding" ? "只登记不物化" : formatBytes(d.sizeBytes)}
                    </p>
                    {d.generating && <p className="text-11 text-warning">生成中 —— 音频已入库，转录派生物后到</p>}
                  </div>
                  {d.downloadable
                    ? <Button size="xs" variant="ghost" data-testid="files-derived-download"><Download aria-hidden className="h-3 w-3" /></Button>
                    : <Badge tone="neutral">—</Badge>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
