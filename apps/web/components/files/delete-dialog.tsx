"use client";
import * as React from "react";
import { Trash2, AlertTriangle, UserCheck, PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Modal } from "./overlay";
import { DELETE_IMPACT } from "@/lib/mock/files";

/**
 * 删除确认 + 影响面预览（UC-22.4 R3 第 8~9 步）。
 *
 * ⚠ 不是一个孤零零的红按钮：删除前必须让人看见代价——版本数 / 派生物数 /
 *   被引用 Segment 数 / 被哪些 Claim 与报告段落引用 / 是否 legal hold /
 *   是否已导出到组织外（回执须如实说明无法回收）。
 * 六类级联失效逐条列出；其中「已支撑已签字决策」的一条**通知拍板人复核，不自动改结论**。
 * 「删除」按钮在填写原因前禁用（防误触 + 全程留痕）。
 */
export function DeleteDialog({ onClose }: { onClose: () => void }) {
  const impact = DELETE_IMPACT;
  const [reason, setReason] = React.useState("");
  const canDelete = reason.trim().length >= 4 && !impact.legalHold;

  return (
    <Modal
      testid="files-delete-dialog"
      width="lg"
      title="删除文件"
      subtitle={impact.fileName}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="files-delete-cancel">取消</Button>
          <Button size="sm" variant="destructive" disabled={!canDelete} data-testid="files-delete-confirm">
            <Trash2 aria-hidden className="h-3.5 w-3.5" /> 确认删除（逻辑失效 ≤5 分钟）
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* 影响面数字 */}
        <div className="grid grid-cols-2 gap-2" data-testid="files-delete-stats">
          <Stat label="版本数" value={`${impact.versionCount}`} />
          <Stat label="派生物数" value={`${impact.derivedCount}`} />
          <Stat label="被引用 Segment" value={`${impact.segmentCount}`} />
          <Stat label="被 Claim 引用" value={`${impact.claims.length}`} />
        </div>

        {/* 被引用的 Claim 与报告段落 */}
        <div className="flex flex-col gap-1.5">
          <p className="text-12 font-medium">被这些结论引用</p>
          {impact.claims.map((c) => (
            <p key={c} className="rounded-sm border border-border-subtle bg-panel px-2 py-1 text-11" data-testid="files-delete-claim">{c}</p>
          ))}
          {impact.reportParagraphs.map((p) => (
            <p key={p} className="rounded-sm border border-border-subtle bg-panel px-2 py-1 text-11" data-testid="files-delete-report">{p}</p>
          ))}
        </div>

        {/* 已导出到组织外——回执须如实说明无法回收 */}
        {impact.exportedOutside && (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-2.5" data-testid="files-delete-exported">
            <PackageOpen aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-11">{impact.exportedOutside}</p>
          </div>
        )}

        <Separator />

        {/* 六类级联失效 */}
        <div className="flex flex-col gap-1.5">
          <p className="text-12 font-medium">删除会级联失效以下对象（缺一即验收不通过）</p>
          {impact.cascade.map((c) => (
            <div
              key={c.no}
              data-testid="files-delete-cascade-row"
              className={`flex items-start gap-2 rounded-md border p-2 ${
                c.emphasis === "danger" ? "border-destructive/30 bg-destructive/5"
                  : c.emphasis === "human" ? "border-ai/20 bg-ai-tint"
                  : "border-border-subtle bg-panel"
              }`}
            >
              <span className="text-12 font-semibold tabular-nums">{c.no}</span>
              <div className="min-w-0">
                <p className="text-12 font-medium">{c.object}</p>
                <p className={`text-11 ${c.emphasis === "human" ? "text-ai-tint-foreground" : "text-muted-foreground"}`}>{c.effect}</p>
              </div>
              {c.emphasis === "human" && <UserCheck aria-hidden className="ml-auto h-4 w-4 shrink-0 text-ai" />}
            </div>
          ))}
        </div>

        {impact.legalHold && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-12" data-testid="files-delete-legalhold">
            <AlertTriangle aria-hidden className="h-4 w-4 shrink-0 text-destructive" />
            该对象处于 legal hold，人工删除请求被拒绝。解除 hold 只有合规负责人可操作。
          </div>
        )}

        <Separator />

        {/* 强制填原因 */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="files-delete-reason" className="text-12 font-medium">删除原因（必填，写入审计）</label>
          <Textarea
            id="files-delete-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            placeholder="例如：受访者撤回同意，按其撤回范围删除录音与转录。"
            data-testid="files-delete-reason"
          />
          {!impact.legalHold && reason.trim().length < 4 && (
            <p className="text-11 text-muted-foreground">填写原因后「确认删除」才可用。</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-panel p-2.5">
      <p className="text-20 font-semibold tabular-nums">{value}</p>
      <p className="text-11 text-muted-foreground">{label}</p>
    </div>
  );
}
