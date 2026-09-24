"use client";
/**
 * 深度评测 S1（#3988）——从 `detail-screen.tsx` 拆出来的几块**无状态**展示：页签按钮、「说明与验收标准」页、
 * 推送确认框与推送成功页。拆分只搬家、不改行为（详情页逼近仓库 2000 行上限，后面几轮都要往它上面加功能）。
 */
import * as React from "react";
import { Check, CheckCircle2, Loader2, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { DesignProject } from "@/lib/live-design-workbench";

/** 「说明与验收标准」页签：问题、验收标准、各页交互说明。 */
export function DetailSpec({ project }: { project: DesignProject }) {
  return (
    <div className="flex-1 overflow-y-auto p-6" data-testid="design-detail-spec">
      <section className="mb-6">
        <h3 className="text-14 font-semibold">问题与目标</h3>
        <p className="mt-1.5 whitespace-pre-wrap text-13 text-muted-foreground">
          {project.problem || "还没填背景。在对话里说清楚要解决的问题，我会补到这里。"}
        </p>
        {project.linkedFeedbackId !== null && (
          <p className="mt-2 text-12">
            关联反馈：<span className="font-mono">{project.linkedFeedbackId}</span>
          </p>
        )}
      </section>
      <section>
        <h3 className="text-14 font-semibold">验收标准</h3>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {project.criteria.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-13">
              <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </section>
      {/* 迭代 8：每页交互说明（模型随整页写回给出；没有就不显示这一节） */}
      {project.frameNotes.some((n) => n.trim() !== "") && (
        <section className="mt-6" data-testid="design-detail-notes">
          <h3 className="text-14 font-semibold">各页交互说明</h3>
          <ol className="mt-1.5 flex flex-col gap-2">
            {project.frames.map((f, i) => {
              const note = (project.frameNotes[i] ?? "").trim();
              if (note === "") return null;
              return (
                <li key={i} className="flex items-start gap-2 text-13" data-testid={`design-detail-note-${i}`}>
                  <MessageSquareText aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span><span className="font-medium">{f}</span>：<span className="text-muted-foreground">{note}</span></span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}

export function DetailTab({ active, onClick, children, testid }: { active: boolean; onClick: () => void; children: React.ReactNode; testid: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testid}
      className={cn(
        "rounded-t-control px-3 py-1.5 text-12 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-b-2 border-primary font-medium text-background-foreground" : "border-b-2 border-transparent text-muted-foreground hover:text-background-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function PushConfirm({
  project, busy, error, onClose, onConfirm,
}: {
  project: DesignProject;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = React.useState("");
  return (
    <div className="dark fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="design-push-confirm">
      <div className="absolute inset-0 bg-inverse/50" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="推送到收件箱" className="relative flex w-full max-w-md flex-col gap-3 rounded-card border border-border bg-card p-5 text-card-foreground shadow-lg">
        <h3 className="text-16 font-semibold">推送「{project.name}」到收件箱</h3>
        <p className="text-12 text-muted-foreground">
          推送后会在运营收件箱生成一条「设计方案」条目（待处理），供工程排期。
          {project.linkedFeedbackId !== null && " 来源反馈会被标注「已生成」。"}
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor="push-note" className="text-11 font-medium text-muted-foreground">给工程的说明（可选）</label>
          <Textarea id="push-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} disabled={busy} placeholder="需要工程特别注意的边界、依赖、验收口径" data-testid="design-push-note" />
        </div>
        {error !== null && (
          <p className="text-11 text-destructive" data-testid="design-push-error" role="alert">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" size="sm" onClick={() => onConfirm(note)} disabled={busy} data-testid="design-push-confirm-submit">
            {busy && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
            确认推送
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PushSuccess({ project, code, onOpenInbox, onNextDesign }: { project: DesignProject; code: string; onOpenInbox?: () => void; onNextDesign?: () => void }) {
  return (
    <div className="dark flex h-dvh flex-col items-center justify-center gap-4 bg-background p-16 text-center text-background-foreground" data-testid="design-push-success">
      <CheckCircle2 aria-hidden className="h-14 w-14 text-success" />
      <div>
        <p className="text-20 font-semibold">已推送到收件箱</p>
        <p className="mt-1 text-13 text-muted-foreground">
          方案 <span className="font-mono">{code}</span> · {project.name}
          {project.linkedFeedbackId !== null && <> · 已与来源反馈互相关联</>}
        </p>
      </div>
      <p className="max-w-sm text-12 text-muted-foreground">
        运营会在收件箱看到这条待处理的设计方案，排期后进入开发。你可以继续设计下一个，或去收件箱确认。
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onNextDesign} data-testid="design-success-next">继续设计下一个</Button>
        <Button variant="primary" size="sm" onClick={onOpenInbox} data-testid="design-success-inbox">查看收件箱</Button>
      </div>
    </div>
  );
}
