"use client";
import * as React from "react";
import Link from "next/link";
import { SendToBack } from "lucide-react";
import { diagramToWhiteboard, mermaidToModel, templateToModel } from "@repo/fabric-markdown";
import { prepareDiagramImport } from "@repo/whiteboard-core";
import type { DiagramImportBundleData, DiagramImportLossCode, ImportDiagramInput } from "@repo/contracts/whiteboard-import";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { importDiagram, listBoards, type Board } from "@/lib/live-whiteboard";

type Kind = "mermaid" | "canvas" | "persona";
type Prepared = { requestId: string; bundle: DiagramImportBundleData; sourceRef: ImportDiagramInput["sourceRef"]; losses: ReturnType<typeof prepareDiagramImport> extends { losses: infer L } ? L : never };
const lossLabels: Record<DiagramImportLossCode, string> = {
  SOURCE_DIAGNOSTIC: "源图包含转换诊断", SHAPE_APPROXIMATION: "部分形状会转为可编辑矩形",
  SPECIALIZED_EDITING_UNAVAILABLE: "专用语义会保留为元数据", ZERO_SIZE_EXPANDED: "零尺寸对象会扩为可选择对象",
  CONNECTOR_SEMANTICS_APPROXIMATED: "连接线语义会近似显示", PLUGIN_STYLE_NOT_RENDERED: "插件样式暂不直接渲染",
};
async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function toModel(code: string, kind: Kind) {
  if (kind === "mermaid") return mermaidToModel(code);
  return kind === "persona" ? templateToModel(code, "persona") : templateToModel(code);
}

export function ChatDiagramBoardInsert(props: {
  code: string; kind: Kind; closed: boolean; threadId?: string; messageId?: string; bearer?: string;
}) {
  const available = props.closed && !!props.threadId && !!props.messageId && props.bearer !== undefined;
  const unavailableReason = !props.closed ? "图表仍在生成，完成后才能插入 Board" : "这段图表还没有稳定的消息来源，无法插入 Board";
  const [open, setOpen] = React.useState(false), [boards, setBoards] = React.useState<Board[]>([]);
  const [boardId, setBoardId] = React.useState(""), [x, setX] = React.useState("120"), [y, setY] = React.useState("120");
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(""), [prepared, setPrepared] = React.useState<Prepared | null>(null);
  const [accepted, setAccepted] = React.useState(false), [result, setResult] = React.useState<{ boardId: string; groupId: string } | null>(null);
  const writable = boards.filter(board => !board.archived && board.role !== "viewer");
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setBusy(true); setError(""); setResult(null); setPrepared(null); setAccepted(false);
    void listBoards(props.bearer).then(items => {
      setBoards(items); const first = items.find(board => !board.archived && board.role !== "viewer"); setBoardId(first?.id ?? "");
    }).catch(() => setError("无法读取可写 Board，请稍后重试。")).finally(() => setBusy(false));
  };
  const build = async (): Promise<Prepared> => {
    const requestId = crypto.randomUUID();
    const model = await toModel(props.code, props.kind);
    const bundle = diagramToWhiteboard(model, requestId, { x: Number(x), y: Number(y) });
    const sourceHash = await sha256(props.code), blockId = await sha256(`${props.kind}\0${props.code}`);
    const sourceRef = { threadId: props.threadId!, messageId: props.messageId!, blockId, kind: props.kind, sourceHash, sourceVersion: `sha256:${sourceHash}` } as const;
    const preview = prepareDiagramImport(bundle, requestId.replaceAll("-", "_"), sourceRef);
    if (!preview.ok) throw new Error(preview.detail);
    return { requestId, bundle, sourceRef, losses: preview.losses };
  };
  const commit = async (candidate: Prepared) => {
    setBusy(true); setError("");
    try {
      const response = await importDiagram(boardId, {
        requestId: candidate.requestId, bundle: candidate.bundle, sourceRef: candidate.sourceRef,
        acceptedLosses: [...new Set(candidate.losses.map(loss => loss.code))],
      }, props.bearer);
      setResult({ boardId: response.boardId, groupId: response.groupId }); setPrepared(null); setAccepted(false);
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status === 409 ? "源图已变化、Board 状态已变化，或本次请求与之前内容冲突。请重新检查。" : "插入失败。请求编号已保留，重试不会重复创建图形。");
    } finally { setBusy(false); }
  };
  const inspect = async () => {
    if (!boardId || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) { setError("请选择 Board 并填写有效位置。"); return; }
    setBusy(true); setError("");
    try {
      const candidate = prepared ?? await build(); setPrepared(candidate);
      if (candidate.losses.length === 0) await commit(candidate);
    } catch { setError("当前图表无法无损转换为 Board 可编辑对象。"); }
    finally { setBusy(false); }
  };
  return <div className="mt-1 flex items-center gap-2" data-testid="chat-diagram-board-insert">
    <Button type="button" size="sm" variant="outline" disabled={!available} title={available ? "插入到 Board" : unavailableReason} onClick={() => changeOpen(true)}>
      <SendToBack aria-hidden className="h-3.5 w-3.5" />插入到 Board
    </Button>
    {!available && <span className="text-11 text-muted-foreground">{unavailableReason}</span>}
    <Dialog open={open} onOpenChange={changeOpen}><DialogContent data-testid="chat-diagram-board-dialog" className="max-w-lg">
      <DialogHeader><DialogTitle>插入到 Board</DialogTitle><DialogDescription>图表将作为一个分组插入，节点和连接线可继续编辑，并保留对话来源。</DialogDescription></DialogHeader>
      {result ? <div className="space-y-3" role="status"><p>已持久写入 Board。</p><Link className="text-primary underline" href={`/studio/board/${result.boardId}?focus=${encodeURIComponent(result.groupId)}`}>打开并定位到图表</Link><Button variant="outline" onClick={() => { setResult(null); setPrepared(null); setAccepted(false); }}>再插入一份</Button></div> : <>
        <label className="text-13">目标 Board<select className="mt-1 block w-full rounded-control border border-border bg-background p-2" data-testid="board-insert-target" value={boardId} onChange={event => { setBoardId(event.target.value); setPrepared(null); }} disabled={busy}><option value="">请选择</option>{writable.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>
        {!busy && writable.length === 0 && <p className="text-13 text-muted-foreground">没有可写的 Board。请先创建 Board 或申请编辑权限。</p>}
        <div className="grid grid-cols-2 gap-3"><label className="text-13">横坐标<Input value={x} onChange={event => { setX(event.target.value); setPrepared(null); }} /></label><label className="text-13">纵坐标<Input value={y} onChange={event => { setY(event.target.value); setPrepared(null); }} /></label></div>
        {prepared && prepared.losses.length > 0 && <section className="rounded-control border border-warning/40 bg-warning/10 p-3 text-12" data-testid="board-insert-losses"><p className="font-medium">转换时会发生以下变化：</p><ul className="list-disc pl-5">{[...new Set(prepared.losses.map(loss => loss.code))].map(code => <li key={code}>{lossLabels[code]}</li>)}</ul><label className="mt-2 flex gap-2"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />我已了解并接受这些变化</label></section>}
        {error && <p role="alert" className="text-13 text-destructive">{error}</p>}
        <DialogFooter>{prepared?.losses.length ? <Button disabled={busy || !accepted} onClick={() => void commit(prepared)}>确认插入</Button> : <Button disabled={busy || !boardId} onClick={() => void inspect()}>{busy ? "检查中…" : "检查并插入"}</Button>}</DialogFooter>
      </>}
    </DialogContent></Dialog>
  </div>;
}
