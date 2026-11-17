"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { aidtCheckpointKey, type useAidtPersonalCheckpoints } from "../lib/use-aidt-personal-checkpoints";
import { aidtUiStageSummary } from "../lib/aidt-ui-drafts";
import type { AidtPersonalStageCheckpoint } from "../lib/aidt-stage-persistence";

type Checkpoints = ReturnType<typeof useAidtPersonalCheckpoints>;
export function AidtPersonalCheckpointPanel({ stageNumber, controller, readOnly, sharedCheckpointKey, onShare }: {
  stageNumber: number; controller: Checkpoints; readOnly: boolean; sharedCheckpointKey?: string;
  onShare: (checkpoint: AidtPersonalStageCheckpoint | null) => void;
}) {
  const [preview, setPreview] = React.useState<{ scope: string; checkpointKey: string } | null>(null);
  const [pendingRestore, setPendingRestore] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState("");
  const checkpoints = controller.load?.result.checkpoints ?? [];
  const selected = preview?.scope === controller.key ? checkpoints.find(checkpoint => aidtCheckpointKey(checkpoint) === preview.checkpointKey) : undefined;
  const restore = () => {
    if (!selected || readOnly) return;
    controller.restore(selected); setPendingRestore(null); setNotice("已恢复到本页表单，尚未同步给小组。服务器检查点保持不变。");
  };
  return <section className="border-b border-border px-4 py-3 text-12" aria-label="个人服务器检查点" data-testid="aidt-personal-checkpoints">
    <details data-testid="aidt-checkpoint-details">
      <summary className="cursor-pointer font-medium" data-testid="aidt-checkpoint-summary">个人检查点 · {controller.save.phase === "saving" ? "保存中" : controller.savedCurrentDraft ? "本页草稿已保存" : controller.load?.phase === "ready" ? `${checkpoints.length} 份服务器保存稿` : controller.load?.phase === "error" ? "读取失败" : controller.readyToRead ? "读取中" : "待本步对话就绪"}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted-foreground">仅自己可见，小组未同步；保存不代表小组已确认或研究证据已核实。此处只保存第 {stageNumber} 步表单，聊天发送与报告编辑分别处理。</p>
        {!controller.readyToRead ? <p role="status" data-testid="aidt-checkpoint-waiting">进入本步对话后可读取个人保存稿。保存时需选择一条真实的本步真人消息作为来源。</p> : controller.load?.phase === "error" ? <div role="alert" data-testid="aidt-checkpoint-load-error"><p>{controller.load.error}</p><Button size="sm" variant="outline" onClick={controller.reload} data-testid="aidt-checkpoint-load-retry">重新读取个人检查点</Button></div> : controller.load?.phase !== "ready" ? <p role="status" data-testid="aidt-checkpoint-loading">正在读取个人服务器检查点…</p> : <>
          {checkpoints.length === 0 ? <p data-testid="aidt-checkpoint-empty">本步还没有你的个人服务器检查点。本页输入不会因此自动保存。</p> : <label className="block">查看或恢复已保存稿<select className="mt-1 block w-full rounded-md border border-border bg-background p-2" aria-label="选择个人保存稿" data-testid="aidt-checkpoint-select" value={selected ? aidtCheckpointKey(selected) : ""} onChange={event => { setPreview({ scope: controller.key, checkpointKey: event.currentTarget.value }); setPendingRestore(null); setNotice(""); onShare(null); }}>
            <option value="">选择一份保存稿，不自动替换本页内容</option>{checkpoints.map(checkpoint => <option key={aidtCheckpointKey(checkpoint)} value={aidtCheckpointKey(checkpoint)}>{checkpoint.savedAt} · {checkpoint.artifactId}</option>)}
          </select></label>}
          {selected && <div className="rounded-md border border-border p-3" data-testid="aidt-checkpoint-preview"><p className="break-all">检查点：{selected.artifactId}</p><p className="break-all">内容修订：{selected.immutableRevision}</p><p>服务端保存时间：{selected.savedAt}</p><details className="mt-2"><summary className="cursor-pointer" data-testid="aidt-checkpoint-preview-content">核对保存内容</summary><p className="mt-2 whitespace-pre-wrap break-words">{aidtUiStageSummary(stageNumber, selected.draft) || "没有可展示的表单内容"}</p></details>
            <Button className="mt-2" size="sm" variant="outline" data-testid="aidt-checkpoint-restore" disabled={readOnly || controller.save.phase === "saving"} onClick={() => controller.hasContent ? setPendingRestore(aidtCheckpointKey(selected)) : restore()}>恢复到本页表单</Button>
            <label className="mt-3 flex items-start gap-2"><input type="checkbox" data-testid="aidt-checkpoint-share" disabled={readOnly} checked={sharedCheckpointKey === aidtCheckpointKey(selected)} onChange={event => onShare(event.currentTarget.checked ? selected : null)} /><span>把所选个人稿加入本页参考，供整理到小组保存稿。当前 AI 仅采用所选共享保存版本，实际使用见运行回执；个人正文不会自动纳入。</span></label>
          </div>}
          {selected && pendingRestore === aidtCheckpointKey(selected) && <div role="alert" className="space-y-2 rounded-md border border-border p-3" data-testid="aidt-checkpoint-restore-confirm"><p>替换本页当前阶段草稿？本页未保存修改将被替换；其他阶段和服务器检查点不变。</p><div className="flex flex-wrap gap-2"><Button size="sm" onClick={restore} disabled={readOnly} data-testid="aidt-checkpoint-restore-confirm-apply">确认恢复所选稿</Button><Button size="sm" variant="outline" onClick={() => setPendingRestore(null)} data-testid="aidt-checkpoint-restore-cancel">保留本页修改</Button></div></div>}
          {readOnly ? <p role="status" data-testid="aidt-checkpoint-readonly">当前只读，可查看自己的保存稿，不能新建检查点或恢复修改。</p> : <>
            <label className="block">选择本次保存的聊天来源<select className="mt-1 block w-full rounded-md border border-border bg-background p-2" aria-label="选择本步真人消息" data-testid="aidt-checkpoint-source" value={controller.messageId} disabled={controller.sources?.loading && !controller.sources.messages.length} onChange={event => controller.selectMessage(event.currentTarget.value)}><option value="">请选择已发送的真人消息，不自动选择</option>{controller.sources?.messages.filter(message => message.authorKind === "human").map(message => <option key={message.id} value={message.id}>{message.createdAt} · {message.text.slice(0,100) || "消息无文字"}</option>)}</select></label>
            {controller.sources?.loading && <p role="status">正在读取聊天来源…</p>}
            {controller.sources?.error && <p role="alert" data-testid="aidt-checkpoint-source-error">{controller.sources.error}</p>}
            {!controller.sources?.loading && !controller.sources?.error && !controller.sources?.messages.some(message => message.authorKind === "human") && <p data-testid="aidt-checkpoint-no-source">没有可选的真人消息。请先在本步对话发送自己的想法，再刷新来源；不会替你创建消息或触发 AI。</p>}
            {controller.sources?.nextCursor && <Button size="sm" variant="outline" disabled={controller.sources.loading} onClick={() => void controller.moreSources()} data-testid="aidt-checkpoint-more-sources">读取下一页聊天来源</Button>}
            {(controller.load?.result.heads.length ?? 0) > 1 && <p role="alert" data-testid="aidt-checkpoint-forks">检测到多个并发分支。各份检查点均保留，可查看与恢复；本版暂不能合并这些分支，不会自动选择最新或覆盖。</p>}
            {controller.needsBaseChoice && (controller.load?.result.heads.length ?? 0) <= 1 && <label className="block">保存基准需人工核对<select className="mt-1 block w-full rounded-md border border-border bg-background p-2" aria-label="选择个人检查点保存基准" data-testid="aidt-checkpoint-base" value={controller.baseHead ? aidtCheckpointKey(controller.baseHead) : ""} onChange={event => controller.selectHead(event.currentTarget.value)}><option value="">存在并发或分支，请先核对并选择基准</option>{(controller.load?.result.heads ?? []).map(checkpoint => <option key={aidtCheckpointKey(checkpoint)} value={aidtCheckpointKey(checkpoint)}>{checkpoint.savedAt} · {checkpoint.artifactId}</option>)}</select></label>}
            <div className="flex flex-wrap gap-2"><Button size="sm" data-testid="aidt-checkpoint-save" disabled={!controller.canSave} onClick={() => void controller.saveCurrent()}>{controller.save.phase === "saving" ? "正在保存个人检查点…" : "保存当前表单为个人检查点"}</Button><Button size="sm" variant="outline" disabled={controller.save.phase === "saving"} data-testid="aidt-checkpoint-reload" onClick={controller.reload}>刷新检查点与聊天来源</Button></div>
          </>}
        </>}
        {controller.save.phase === "saved" && controller.save.checkpoint && <div role="status" data-testid="aidt-checkpoint-receipt"><p>{controller.savedCurrentDraft ? "已回读确认本次个人服务器检查点。" : "上一份提交已回读确认；当前新修改尚未保存。"}仅自己可见，小组未同步。</p><p className="break-all">{controller.save.checkpoint.artifactId} · {controller.save.checkpoint.immutableRevision} · {controller.save.checkpoint.savedAt}</p></div>}
        {(controller.save.phase === "error" || controller.save.phase === "conflict") && <div role="alert" data-testid={controller.save.phase === "conflict" ? "aidt-checkpoint-conflict" : "aidt-checkpoint-save-error"}><p>{controller.save.error}</p><p>本页草稿保留。不会自动覆盖其他保存稿；并发时请核对保存基准。</p>{controller.save.checkpoint && <p className="break-all">已有可恢复的个人检查点：{controller.save.checkpoint.artifactId}。请重新读取并核对，不能据此认定当前修改已保存。</p>}</div>}
        {notice && <p role="status" data-testid="aidt-checkpoint-restore-notice">{notice}</p>}
      </div>
    </details>
  </section>;
}
