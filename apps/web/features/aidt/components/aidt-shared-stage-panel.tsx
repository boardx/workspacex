"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { aidtUiStageSummary } from "../lib/aidt-ui-drafts";
import type { useAidtSharedStages } from "../lib/use-aidt-shared-stages";

export function AidtSharedStagePanel({ controller: c, stageNumber, readOnly, entityPreview }: {
  controller: ReturnType<typeof useAidtSharedStages>; stageNumber: number; readOnly: boolean; entityPreview?: string;
}) {
  const [replace, setReplace] = React.useState(false);
  if (!c.available) return <p className="border-b px-4 py-2 text-12 text-muted-foreground" data-testid="aidt-shared-unavailable">登录后可读取和保存本组成果。</p>;
  const loading = !c.read || c.read.phase === "loading";
  return <section className="shrink-0 border-b border-border px-4 py-2 text-12" aria-label="本步小组保存" data-testid="aidt-shared-stage">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p role="status" data-testid="aidt-shared-status">{loading ? "正在读取小组成果…" : c.read?.phase === "error" ? "小组成果读取失败" : c.matchesServer ? `小组已保存 · V${c.server?.revision}` : c.server ? `服务器 V${c.server.revision} · 本页有未保存内容` : "本组尚未保存本步"}</p>
      <div className="flex items-center gap-2"><Button size="icon" variant="ghost" aria-label="刷新成果" onClick={c.reload} disabled={loading || c.write.phase === "saving"} data-testid="aidt-shared-reload"><RefreshCw aria-hidden className="h-4 w-4" /></Button>{!readOnly && <Button size="sm" variant={stageNumber === 1 ? "outline" : "primary"} onClick={() => void c.saveCurrent()} disabled={!c.canSave || c.matchesServer} data-testid="aidt-shared-save">{c.write.phase === "saving" ? "正在保存…" : stageNumber === 1 ? "保存小组草稿" : "保存到小组"}</Button>}</div>
    </div>
    {c.read?.phase === "error" && <p role="alert" className="mt-2" data-testid="aidt-shared-load-error">{c.read.error}</p>}
    {c.write.phase === "error" && <p role="alert" className="mt-2" data-testid="aidt-shared-save-error">{c.write.error}</p>}
    {c.write.phase === "conflict" && <div role="alert" className="mt-2" data-testid="aidt-shared-conflict"><p>{c.write.error}</p>{c.needsBaseReview && c.read?.phase === "ready" && <Button variant="outline" size="sm" className="mt-2" onClick={c.reviewServerBase} data-testid="aidt-shared-use-server-base">已比较，保留本页内容并基于服务器 V{c.server?.revision ?? 0} 继续编辑</Button>}</div>}
    {c.write.phase === "saved" && c.write.stage && <p className="mt-2 text-muted-foreground" data-testid="aidt-shared-receipt">已保存到小组 · V{c.write.stage.revision}{!c.matchesServer ? " · 当前新修改尚未保存" : ""}</p>}
    {(c.server || stageNumber > 1) && <details className="mt-1" data-testid="aidt-shared-details"><summary className="cursor-pointer text-muted-foreground">保存记录与引用</summary><p className="mt-2 text-muted-foreground">保存不代表小组确认或阶段完成。</p>
      {c.server && <div className="mt-2 space-y-2"><p>服务器 V{c.server.revision} · {c.server.updatedBy} · {c.server.updatedAt}</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-sans" data-testid="aidt-shared-server-preview">{(entityPreview ?? aidtUiStageSummary(stageNumber, c.server.content.draft)) || "已保存空草稿"}</pre>{!readOnly && !c.matchesServer && <Button size="sm" variant="outline" onClick={() => setReplace(true)} data-testid="aidt-shared-restore">恢复服务器稿到本页</Button>}{replace && <div role="alertdialog" aria-label="替换本页内容"><p>服务器稿将替换本页尚未保存的内容。确认恢复？</p><Button size="sm" onClick={() => { c.restoreServer(); setReplace(false); }} data-testid="aidt-shared-restore-confirm">确认恢复</Button><Button size="sm" variant="outline" onClick={() => setReplace(false)}>取消</Button></div>}</div>}
      {stageNumber > 1 && entityPreview === undefined && <fieldset className="mt-3 space-y-1" disabled={readOnly || c.read?.phase !== "ready" || c.write.phase === "saving"}><legend className="mb-1">本步实际使用的前序已保存版本（由学生核对）</legend>{Array.from({ length: stageNumber - 1 }, (_, index) => index + 1).map(id => { const stage = c.stages[id], selected = c.sourceStageRevisions.find(value => value.stageId === id); return <label className="flex items-center gap-2" key={id}><input type="checkbox" checked={Boolean(selected)} disabled={!stage || readOnly || (c.lockedSourceStage?.stageId === id)} onChange={event => c.chooseSource(id, event.currentTarget.checked)} data-testid={`aidt-shared-source-${id}`} />第 {id} 步{selected ? ` · 引用 V${selected.revision}` : stage ? ` · V${stage.revision}` : " · 尚未保存"}{selected && stage && selected.revision !== stage.revision ? (c.lockedSourceStage?.stageId === id ? `（本轮固定引用 V${selected.revision}；当前已有 V${stage.revision}）` : `（当前已有 V${stage.revision}，重新勾选可更新引用）`) : ""}</label>; })}</fieldset>}
    </details>}
  </section>;
}
