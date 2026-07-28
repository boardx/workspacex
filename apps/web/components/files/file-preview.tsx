"use client";
import * as React from "react";
import {
  Download, FileWarning, PlugZap, ShieldAlert, History, Trash2, CornerUpRight, Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SOURCE_ICON, SynthesizedBadge, ConfidentialBadge, OriginBadge } from "./status";
import {
  type FileItem, SOURCE_META, INGEST_META, VISIBILITY_LABEL, formatBytes,
} from "@/lib/mock/files";

/**
 * 右预览面板 —— 五类预览（PDF / 图片 / 音频 / 文本-Markdown / JSONL-CSV）。
 * 不支持预览的类型**明确说「请下载查看」并给下载按钮**，不显示空白或转圈（UC-22.1 R3 第 4 步）。
 * 对象存储不可用（depFailed）时下载置灰并说明原因；完整性校验失败时禁止下载（E1/E4）。
 */
export function FilePreview({
  file, depFailed, onOpenVersions, onDelete,
}: {
  file: FileItem | null;
  depFailed: boolean;
  onOpenVersions: () => void;
  onDelete: () => void;
}) {
  if (!file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center" data-testid="files-preview-none">
        <FileWarning aria-hidden className="h-6 w-6 text-muted-foreground" />
        <p className="text-12 text-muted-foreground">在中间列表选一份文件，这里预览它的内容与版本</p>
      </div>
    );
  }

  const Icon = SOURCE_ICON[file.sourceType];
  const meta = INGEST_META[file.ingest];
  const integrityFailed = file.integrity === "failed";
  const quarantined = Boolean(file.quarantineNote);
  const downloadBlocked = depFailed || integrityFailed || quarantined || !meta.downloadable;

  return (
    <div className="flex h-full flex-col" data-testid="files-preview">
      <div className="flex items-start gap-2 p-3 pb-2">
        <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-13 font-semibold" title={file.name} data-testid="files-preview-name">
            {file.name}.{file.ext}
          </p>
          <p className="text-11 text-muted-foreground">
            {SOURCE_META.find((s) => s.key === file.sourceType)?.label} · v{file.versionCount} · {formatBytes(file.sizeBytes)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 px-3 pb-2">
        <OriginBadge system={SOURCE_META.find((s) => s.key === file.sourceType)!.system} />
        {file.confidential && <ConfidentialBadge />}
        {file.synthesized && <SynthesizedBadge />}
      </div>

      {/* synthesized 顶部横幅（UC-22.3 R8：生成物预览面板顶部横幅）*/}
      {file.synthesized && (
        <div className="mx-3 mb-2 rounded-md border border-ai/20 bg-ai-tint p-2 text-11 text-ai-tint-foreground" data-testid="files-preview-synth-banner">
          AI 生成内容，标记为 synthesized。服务端以 evidencePolicy: primary-only 强制其不作为一手证据参与决策检索。
        </div>
      )}

      <Separator />

      {/* 预览主体 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {integrityFailed ? (
          <PreviewNotice
            testid="files-preview-integrity"
            icon={<ShieldAlert aria-hidden className="h-5 w-5 text-destructive" />}
            title="完整性校验失败"
            body="对象存储中该对象的 SHA-256 与登记值不匹配。已禁止下载、触发告警并写审计——不会悄悄给你一个损坏文件。"
          />
        ) : quarantined ? (
          <PreviewNotice
            testid="files-preview-quarantine"
            icon={<Lock aria-hidden className="h-5 w-5 text-warning" />}
            title="隔离中 · 不可下载"
            body={file.quarantineNote!}
          />
        ) : depFailed ? (
          <PreviewNotice
            testid="files-preview-depfail"
            icon={<PlugZap aria-hidden className="h-5 w-5 text-warning" />}
            title="对象存储暂不可用"
            body="元数据来自 PG 仍可查看，但预览与下载暂不可用。这不是「点了没反应」——按钮已置灰并说明原因。"
          />
        ) : (
          <PreviewBody file={file} />
        )}
      </div>

      <Separator />

      {/* 版本 / 派生物 / 溯源 快捷入口 */}
      <div className="flex flex-col gap-1.5 p-3 text-11">
        <button
          type="button"
          onClick={onOpenVersions}
          data-testid="files-preview-versions"
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-muted-foreground transition-all duration-200 hover:bg-muted hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <History aria-hidden className="h-3 w-3" /> 版本历史（{file.versionCount} 版）
        </button>
        {file.sourceRef && (
          <div className="flex items-center gap-1.5 px-1.5 text-muted-foreground" data-testid="files-preview-sourceref">
            <CornerUpRight aria-hidden className="h-3 w-3" /> 来源：{file.sourceRef}（点「来源」反向跳回业务对象）
          </div>
        )}
      </div>

      <Separator />

      {/* 动作条 */}
      <div className="flex items-center gap-2 p-3">
        <Button
          size="sm"
          variant="primary"
          disabled={downloadBlocked}
          data-testid="files-preview-download"
          title={downloadBlocked ? "当前不可下载（见上方原因）" : "签发短时效、一次性、绑定 principal 的下载 URL"}
        >
          <Download aria-hidden className="h-3.5 w-3.5" /> 下载原件
        </Button>
        <Button size="sm" variant="outline" onClick={onDelete} data-testid="files-preview-delete">
          <Trash2 aria-hidden className="h-3.5 w-3.5" /> 删除
        </Button>
      </div>
    </div>
  );
}

function PreviewBody({ file }: { file: FileItem }) {
  switch (file.preview) {
    case "pdf":
      return (
        <div className="flex flex-col gap-2" data-testid="files-preview-pdf">
          <div className="flex items-center justify-between text-11 text-muted-foreground">
            <span>PDF · 可分页跳转 · 支持锚点直达（页码）</span>
            <span className="tabular-nums">第 3 / 42 页</span>
          </div>
          <div className="flex h-56 flex-col gap-1.5 rounded-md border border-border bg-panel p-3">
            <div className="h-2.5 w-2/3 rounded-sm bg-muted" />
            <div className="h-2.5 w-full rounded-sm bg-muted" />
            <div className="h-2.5 w-11/12 rounded-sm bg-muted" />
            <div className="mt-2 h-2.5 w-1/2 rounded-sm bg-muted" />
            <div className="h-2.5 w-full rounded-sm bg-muted" />
          </div>
        </div>
      );
    case "image":
      return (
        <div className="flex flex-col gap-2" data-testid="files-preview-image">
          <div className="flex h-56 items-center justify-center rounded-md border border-border bg-panel">
            <SOURCE_ICON.workshop aria-hidden className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-11 text-muted-foreground">可缩放 · EXIF 摘要：4032×3024 · f/1.8 · 2026-07-16 16:05 · 无 GPS</p>
        </div>
      );
    case "audio":
      return (
        <div className="flex flex-col gap-2" data-testid="files-preview-audio">
          <div className="flex h-16 items-end gap-0.5 rounded-md border border-border bg-panel p-2">
            {Array.from({ length: 48 }).map((_, i) => (
              <span key={i} className="w-1 rounded-full bg-primary" style={{ height: `${20 + ((i * 37) % 70)}%` }} />
            ))}
          </div>
          <p className="text-11 text-muted-foreground">
            波形 + 时间码定位 · {formatBytes(file.sizeBytes)}
            {file.sizeBytes > 1_000_000_000 && "（超大文件：下载走分片，预览为流式）"}
          </p>
          <p className="text-11 text-muted-foreground">跳转 14:12 段 · 「采购委员会为什么不敢签？」</p>
        </div>
      );
    case "jsonl":
      return (
        <div className="flex flex-col gap-1" data-testid="files-preview-jsonl">
          <p className="text-11 text-muted-foreground">JSONL · 分行表格化（不是裸文本块）· 每行一条消息，anchor 精确到 message_id</p>
          {["msg-01 · 项目经理 · 14:31", "msg-02 · Ava · MECE 假设拆解", "msg-03 · Ledger · 收益测算（工具调用 3）"].map((r) => (
            <div key={r} className="rounded-sm border border-border-subtle bg-panel px-2 py-1 text-11 font-mono">{r}</div>
          ))}
        </div>
      );
    case "csv":
      return (
        <div className="flex flex-col gap-1" data-testid="files-preview-csv">
          <p className="text-11 text-muted-foreground">CSV · 148 行回收 · 题号与 schema.json 一一对应</p>
          <div className="overflow-hidden rounded-md border border-border text-11">
            {["受访者 · 提交时间 · Q1 · Q2 …", "R-0001 · 07-13 · A · 是 …", "R-0002 · 07-13 · C · 否 …"].map((r, i) => (
              <div key={r} className={i === 0 ? "bg-muted px-2 py-1 font-medium" : "border-t border-border-subtle px-2 py-1 font-mono"}>{r}</div>
            ))}
          </div>
        </div>
      );
    case "markdown":
    case "text":
      return (
        <div className="flex flex-col gap-1.5 rounded-md border border-border bg-panel p-3" data-testid="files-preview-text">
          <p className="text-12 font-medium">{file.preview === "markdown" ? "Markdown 渲染预览" : "文本预览"}</p>
          <p className="text-11 text-muted-foreground">
            {file.sourceType === "canvas"
              ? "flowchart LR — 进入模式假设树，6 节点，3 个致命假设已标红。mermaid 源码为权威形式（D-08）。"
              : "首段摘要 · 结构化字段保留 · 完整内容请下载查看。"}
          </p>
        </div>
      );
    default:
      return (
        <PreviewNotice
          testid="files-preview-unsupported"
          icon={<FileWarning aria-hidden className="h-5 w-5 text-muted-foreground" />}
          title="此类型不支持预览"
          body="Office / 二进制等类型不在主域内联渲染（防 XSS / SVG 脚本 / HTML 直渲）。请下载查看。"
        />
      );
  }
}

function PreviewNotice({
  testid, icon, title, body,
}: { testid: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-8 text-center" data-testid={testid}>
      {icon}
      <p className="text-12 font-medium">{title}</p>
      <p className="max-w-xs text-11 text-muted-foreground">{body}</p>
    </div>
  );
}
