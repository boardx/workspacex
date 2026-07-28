"use client";
import * as React from "react";
import { Check, X, ShieldQuestion, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { SynthesizedBadge, ConfidentialBadge, SOURCE_ICON } from "./status";
import {
  FILES, REVIEW_REASON_LABEL, SOURCE_LABEL, formatBytes, type FileItem,
} from "@/lib/mock/files";

/**
 * REVIEW_PENDING 人工复核界面（UC-22.2 R3 第 11 步 / R11 独立屏）。
 * 满足机密 / 疑似 PII / 解析质量低任一者落此。审核人接受后才 READY、才进检索。
 * 接受/拒绝均写审计——所以强制填一句处置理由。
 * [待确认] 审核人角色（负责人 / 合规 / 两者）见 README。
 */
export function ReviewPanel() {
  const pending = FILES.filter((f) => f.ingest === "REVIEW_PENDING");
  const [activeId, setActiveId] = React.useState(pending[0]?.id ?? null);
  const active = pending.find((f) => f.id === activeId) ?? null;

  return (
    <div className="flex h-full min-h-0" data-testid="files-review-panel">
      {/* 队列 */}
      <div className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="p-3 pb-2">
          <h2 className="text-13 font-semibold">待复核 · {pending.length}</h2>
          <p className="text-11 text-muted-foreground">接受前不进检索召回</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {pending.map((f) => {
            const Icon = SOURCE_ICON[f.sourceType];
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setActiveId(f.id)}
                data-testid="files-review-queue-item"
                className={`flex w-full items-start gap-2 rounded-md p-2 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${f.id === activeId ? "bg-muted" : "hover:bg-panel"}`}
              >
                <Icon aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-12 font-medium">{f.name}.{f.ext}</p>
                  <p className="text-11 text-muted-foreground">{(f.reviewReasons ?? []).map((r) => REVIEW_REASON_LABEL[r].split("（")[0]).join(" · ")}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 详情 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {active ? <ReviewDetail file={active} /> : <p className="text-12 text-muted-foreground">队列为空</p>}
      </div>
    </div>
  );
}

function ReviewDetail({ file }: { file: FileItem }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4" data-testid="files-review-detail">
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <h1 className="text-16 font-semibold">{file.name}.{file.ext}</h1>
          {file.confidential && <ConfidentialBadge />}
          {file.synthesized && <SynthesizedBadge />}
        </div>
        <p className="mt-0.5 text-12 text-muted-foreground">
          {SOURCE_LABEL[file.sourceType]} · {formatBytes(file.sizeBytes)} · 由 {file.uploader.name} 上传
        </p>
      </div>

      {/* 落入复核的原因 */}
      <div className="flex flex-col gap-2">
        <p className="text-12 font-medium">为什么停在这里</p>
        {(file.reviewReasons ?? []).map((r) => (
          <div key={r} className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-2.5" data-testid="files-review-reason">
            <ShieldQuestion aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-12">{REVIEW_REASON_LABEL[r]}</p>
          </div>
        ))}
      </div>

      {/* 检出详情：PII 命中定位（脱敏展示，不回显真实值）*/}
      {file.reviewReasons?.includes("pii") && (
        <div className="flex flex-col gap-1.5" data-testid="files-review-pii">
          <p className="text-12 font-medium">检出详情（脱敏展示，不回显真实值）</p>
          {["第 2 页 · 手机号 1 处（138 •••• 2049）", "第 5 页 · 邮箱 1 处（l••@••.cn）"].map((d) => (
            <div key={d} className="flex items-center gap-2 rounded-sm border border-border-subtle bg-panel px-2 py-1 text-11">
              <Eye aria-hidden className="h-3 w-3 text-muted-foreground" /> {d}
            </div>
          ))}
        </div>
      )}

      {file.synthesized && (
        <div className="rounded-md border border-ai/20 bg-ai-tint p-2.5 text-11 text-ai-tint-foreground" data-testid="files-review-synth">
          AI 生成内容：附 provenance.json（prompt / model / model_version / run_id / 输入 Context Pack / 生成时间 / 触发者）。接受后仍标 synthesized，且服务端强制不作一手证据。
        </div>
      )}

      <Separator />

      {/* 处置：接受 / 拒绝，强制填理由（写审计）*/}
      <div className="flex flex-col gap-2">
        <p className="text-12 font-medium">处置意见（接受 / 拒绝都会写入审计）</p>
        <Textarea rows={3} placeholder="例如：机密材料已确认由客户授权入库，路由维持仅本地模型。" data-testid="files-review-note" />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" data-testid="files-review-accept"><Check aria-hidden className="h-3.5 w-3.5" /> 接受并转 READY</Button>
          <Button size="sm" variant="outline" data-testid="files-review-reject"><X aria-hidden className="h-3.5 w-3.5" /> 拒绝</Button>
        </div>
      </div>
    </div>
  );
}
