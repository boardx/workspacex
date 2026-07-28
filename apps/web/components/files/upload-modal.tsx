"use client";
import * as React from "react";
import { UploadCloud, FileCheck2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "./overlay";

/**
 * 上传弹层（UC-22.2 R8）—— 选文件 + 设元数据。提交后收进右下角进度抽屉。
 * 前端预检**逐个列原因**（不是笼统「上传失败」）；服务端会完整重做全部校验。
 * 机密勾选旁显示「继承自项目默认」，让用户知道自己在覆盖什么（O-17）。
 * 幂等命中时二选一，**默认选中「使用已有」**（A3）。
 */
export function UploadModal({
  boundSegment, onClose, onSubmit,
}: {
  boundSegment: string | null;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const [confidential, setConfidential] = React.useState(true); // 继承自项目默认：是
  const [visibility, setVisibility] = React.useState("all");

  return (
    <Modal
      testid="files-upload-modal"
      title="上传材料"
      subtitle={boundSegment ? `将绑定环节：${boundSegment}（入口一）` : "不绑定环节（入口二），落在「未归入环节」，事后可归入"}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="files-upload-cancel">取消</Button>
          <Button size="sm" variant="primary" onClick={onSubmit} data-testid="files-upload-submit">
            <UploadCloud aria-hidden className="h-3.5 w-3.5" /> 开始上传 2 份
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* 拖拽区 */}
        <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border bg-panel py-8 text-center" data-testid="files-upload-dropzone">
          <UploadCloud aria-hidden className="h-6 w-6 text-muted-foreground" />
          <p className="text-12">把文件拖到这里，或 <span className="text-primary">点击选择</span></p>
          <p className="text-11 text-muted-foreground">单文件 ≤ 2 GB · 单次批量 ≤ 20 份（上限为 [待确认] 提议值）</p>
        </div>

        {/* 预检结果：通过 / 逐个列出失败原因 */}
        <div className="flex flex-col gap-1.5">
          <p className="text-11 font-medium text-muted-foreground">前端预检（服务端会完整重做）</p>
          <PrecheckRow ok name="季度供应商评估.pptx" note="12 MB · 类型在白名单内" />
          <PrecheckRow ok name="现场录音 · 补充访谈.m4a" note="184 MB · 类型在白名单内" />
          <PrecheckRow name="导出.svg" note="被拒：.svg 可含脚本，不在白名单内（见 UC-22.2 R10 待确认）" />
          <PrecheckRow name="备份.zip（解压后 42 GB）" note="被拒：解压后超上限 2 GB / 嵌套超 3 层——疑似解压炸弹" />
        </div>

        {/* 元数据 */}
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <Checkbox
            checked={confidential}
            onChange={(e) => setConfidential(e.currentTarget.checked)}
            label="含客户机密"
            description="继承自项目默认：是。勾选后该材料进入 REVIEW_PENDING，处理路由受「机密仅本地模型」约束（不可关闭）。"
            data-testid="files-upload-confidential"
          />
          <div className="flex flex-col gap-1">
            <span className="text-11 font-medium text-muted-foreground">可见性范围</span>
            <div className="flex flex-wrap gap-1.5" data-testid="files-upload-visibility">
              {([["all", "全场"], ["group", "本组"], ["private", "私有"], ["team", "仅某团队"]] as const).map(([v, label]) => (
                <Button
                  key={v}
                  size="xs"
                  variant={visibility === v ? "primary" : "outline"}
                  onClick={() => setVisibility(v)}
                  data-testid="files-upload-visibility-option"
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* 幂等命中提示：默认选中「使用已有」 */}
        <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/5 p-3" data-testid="files-upload-duplicate">
          <p className="flex items-center gap-1.5 text-12 font-medium">
            <AlertTriangle aria-hidden className="h-3.5 w-3.5 text-warning" />
            「客户 RFP.pdf」已在库中（v3，2026-07-12 由 林可 上传）
          </p>
          <div className="flex gap-2">
            <Button size="xs" variant="primary" data-testid="files-upload-use-existing">使用已有（默认）</Button>
            <Button size="xs" variant="outline" data-testid="files-upload-as-new">仍然作为新版本上传</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PrecheckRow({ ok, name, note }: { ok?: boolean; name: string; note: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border-subtle bg-panel px-2.5 py-1.5" data-testid="files-upload-precheck-row">
      {ok
        ? <CheckCircle2 aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
        : <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
      <div className="min-w-0">
        <p className="truncate text-12 font-medium">{name}</p>
        <p className={ok ? "text-11 text-muted-foreground" : "text-11 text-destructive"}>{note}</p>
      </div>
      {ok && <FileCheck2 aria-hidden className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
    </div>
  );
}
