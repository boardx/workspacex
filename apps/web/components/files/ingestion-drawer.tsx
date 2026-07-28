"use client";
import * as React from "react";
import { RotateCw, FilePlus2, Check, AlertTriangle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Drawer } from "./overlay";
import { IngestBadge } from "./status";
import { useReviewState } from "./use-review-state";
import {
  INGEST_PIPELINE, INGESTION_RUNS, INGEST_META, REVIEW_REASON_LABEL,
  type IngestState, type IngestionRunView,
} from "@/lib/mock/files";

/**
 * 摄取进度抽屉（UC-22.2 R8）—— 九态状态机的界面呈现。
 *
 * ⚠ 这是原型完全没有、且最容易被做成「转圈圈」的地方。此处刻意反其道：
 *   - 顶部一条**九态阶梯**，让人看清一份文件卡在哪一态、还差几步；
 *   - 每态都标出**用户可见的出口**（没有出口的中间态 = 黑洞）；
 *   - 失败态走**三段式**：在哪一步失败 + 为什么 + 能做什么；
 *   - STORED 之后即标「原件已可下载」，与「已可检索」分开标（两件事）。
 *
 * D-U11：本抽屉是复核处置的**权威入口**。REVIEW_PENDING 的接受/拒绝写入
 *   `useReviewState` 的共享状态——在这里接受一条，独立复核屏里同一条立刻变态。
 */
export function IngestionDrawer({ onClose }: { onClose: () => void }) {
  return (
    <Drawer
      testid="files-ingestion-drawer"
      title="摄取进度"
      subtitle="上传后收进这里，可继续做别的事。多文件逐行显示，可单独重试。"
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        {INGESTION_RUNS.map((run) => (
          <RunCard key={run.id} run={run} />
        ))}

        <Separator />

        {/* 九态图例：把「入库」这个词背后的九个状态摊开，含义 + 出口 + 是否可下载/可检索 */}
        <div className="flex flex-col gap-2">
          <p className="text-11 font-medium text-muted-foreground">九态状态机 · 每态的含义与出口</p>
          {INGEST_PIPELINE.map((s, i) => (
            <div key={s.key} className="flex gap-2 rounded-md border border-border-subtle bg-panel p-2" data-testid="files-ingestion-legend-row">
              <span className="mt-0.5 w-4 shrink-0 text-11 tabular-nums text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <IngestBadge state={s.key} />
                  {s.downloadable && <span className="text-10 text-success">原件可下载</span>}
                  {s.retrievable && <span className="text-10 text-primary">已进检索</span>}
                </div>
                <p className="mt-1 text-11 text-muted-foreground">{s.meaning}</p>
                <p className="mt-0.5 text-11">出口：{s.exits.join(" · ")}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Drawer>
  );
}

const ORDER: IngestState[] = INGEST_PIPELINE.filter((s) => s.key !== "REVIEW_PENDING").map((s) => s.key);

function RunCard({ run }: { run: IngestionRunView }) {
  const idx = ORDER.indexOf(run.state === "REVIEW_PENDING" ? "INDEXED" : run.state);
  const meta = INGEST_META[run.state];
  // 失败态重试/手工补录、检出详情展开走本地态；复核处置走共享态（D-U11）。
  const [action, setAction] = React.useState<null | "retry" | "manual">(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const { dispositions, resolve } = useReviewState();
  const disposition = run.artifactId ? dispositions[run.artifactId] ?? null : null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="files-ingestion-run">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-12 font-medium" title={run.fileName}>{run.fileName}</p>
        <span className="shrink-0 text-11 tabular-nums text-muted-foreground">{run.elapsed}</span>
      </div>

      {/* 九态阶梯：走到哪一步一目了然 */}
      <div className="flex items-center gap-0.5" data-testid="files-ingestion-ladder">
        {ORDER.map((st, i) => (
          <span
            key={st}
            title={INGEST_META[st].label}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors duration-200",
              run.failure && i === idx ? "bg-destructive"
                : i < idx ? "bg-primary"
                : i === idx ? (run.state === "READY" ? "bg-success" : "bg-primary")
                : "bg-muted",
            )}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <IngestBadge state={run.state} />
        {meta.downloadable && !run.failure && <span className="text-10 text-success">原件可下载</span>}
      </div>

      <p className="text-11 text-muted-foreground">{meta.meaning}</p>

      {/* 幂等命中：使用已有 / 仍作为新版本 */}
      {run.duplicateOf && (
        <div className="rounded-md border border-border-subtle bg-panel p-2 text-11" data-testid="files-ingestion-duplicate">
          幂等命中：{run.duplicateOf}
        </div>
      )}

      {/* 失败三段式：在哪一步失败 + 为什么 + 能做什么 */}
      {run.failure && (
        <div className="flex flex-col gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2" data-testid="files-ingestion-failure">
          <p className="flex items-center gap-1.5 text-11 font-medium">
            <AlertTriangle aria-hidden className="h-3 w-3 text-warning" /> 在「{run.failure.where}」这一步失败
          </p>
          <p className="text-11 text-muted-foreground">{run.failure.why}</p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="xs" variant="outline" onClick={() => setAction("retry")} data-testid="files-ingestion-retry"><RotateCw aria-hidden className="h-3 w-3" /> 重试</Button>
            <Button size="xs" variant="ghost" onClick={() => setAction("manual")} data-testid="files-ingestion-manual"><FilePlus2 aria-hidden className="h-3 w-3" /> 手工补文本版</Button>
          </div>
          {action === "retry" && (
            <p role="status" className="inline-flex items-center gap-1 text-11 text-primary" data-testid="files-ingestion-retry-status">
              <RotateCw aria-hidden className="h-3 w-3" /> 已重新排队：从「{run.failure.where}」这一步重试，原件不受影响。
            </p>
          )}
          {action === "manual" && (
            <p role="status" className="inline-flex items-center gap-1 text-11 text-primary" data-testid="files-ingestion-manual-status">
              <FilePlus2 aria-hidden className="h-3 w-3" /> 已切到手工补文本：粘贴正文后作为该版本的抽取结果登记。
            </p>
          )}
        </div>
      )}

      {/* REVIEW_PENDING：接受 / 拒绝 / 查看检出详情（权威入口，写共享状态）*/}
      {run.state === "REVIEW_PENDING" && (
        <div className="flex flex-col gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2" data-testid="files-ingestion-review">
          <p className="text-11 font-medium">等待人工确认</p>
          {run.reviewReasons?.map((r) => (
            <p key={r} className="text-11 text-muted-foreground">· {REVIEW_REASON_LABEL[r]}</p>
          ))}
          <p className="text-10 text-muted-foreground">就地处置即可；这与独立复核屏是同一个动作，处置后两处同步。</p>
          {!disposition ? (
            <div className="flex flex-wrap gap-1.5">
              <Button size="xs" variant="primary" onClick={() => run.artifactId && resolve(run.artifactId, "accepted")} data-testid="files-ingestion-accept"><Check aria-hidden className="h-3 w-3" /> 接受</Button>
              <Button size="xs" variant="outline" onClick={() => run.artifactId && resolve(run.artifactId, "rejected")} data-testid="files-ingestion-reject">拒绝</Button>
              <Button size="xs" variant="ghost" onClick={() => setDetailOpen((v) => !v)} data-testid="files-ingestion-detail">查看检出详情 <ArrowRight aria-hidden className="h-3 w-3" /></Button>
            </div>
          ) : (
            <p role="status" className={disposition === "accepted" ? "inline-flex items-center gap-1 text-11 text-success" : "inline-flex items-center gap-1 text-11 text-destructive"} data-testid="files-ingestion-review-status">
              <Check aria-hidden className="h-3 w-3" /> {disposition === "accepted" ? "已接受并转 READY，进入检索召回；处置写入审计。" : "已拒绝：不入检索，材料退回上传者；处置写入审计。"}
            </p>
          )}
          {detailOpen && !disposition && (
            <div className="flex flex-col gap-1 rounded-sm border border-border-subtle bg-card p-2" data-testid="files-ingestion-detail-panel">
              <p className="text-11 font-medium">检出详情（脱敏展示，不回显真实值）</p>
              <p className="text-11 text-muted-foreground">第 2 页 · 手机号 1 处（138 •••• 2049）</p>
              <p className="text-11 text-muted-foreground">第 5 页 · 邮箱 1 处（l••@••.cn）</p>
            </div>
          )}
        </div>
      )}

      <p className="text-11">出口：{meta.exits.join(" · ")}</p>
    </div>
  );
}
