'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { mindmapStateVector, readObjects, WhiteboardMindmapCommand } from '@repo/whiteboard-core';
import { WhiteboardOperationReceipt, type WhiteboardOperationReceipt as Receipt } from '@repo/contracts/whiteboard-operation';
import { useOptionalSession } from '@/components/session/session-provider';
import { apiRequest } from '@/lib/api-client';
import { executeBoardOperation } from '@/lib/whiteboard-operation-client';
import { planBoardMindmap, type MindmapAction } from './board-mindmap-planner';

type Revision = { epoch: number; seq: number };
export function useBoardMindmap(input: { boardId: string; doc: Y.Doc; readOnly: boolean; role: 'owner'|'editor'|'commenter'|'viewer'; revision: Revision|null; onSelection: (ids: string[]) => void; onNotice: (message: string) => void; onCreatedRoot?: (id:string)=>void }) {
  const { boardId, doc, onSelection, onNotice, revision: appliedRevision, readOnly, role, onCreatedRoot } = input;
  const session = useOptionalSession();
  const [busy, setBusy] = useState(false), [pendingRevision, setPendingRevision] = useState(0);
  const busyRef = useRef(false), scope = useRef(0);
  const undo = useRef<Receipt[]>([]), redo = useRef<Receipt[]>([]);
  const queuedHistory=useRef<'undo'|'redo'|null>(null);
  const historyAction=useRef<(direction:'undo'|'redo')=>Promise<boolean>>(async()=>false);
  const drainHistory=useCallback(()=>{const next=queuedHistory.current;queuedHistory.current=null;if(next)void historyAction.current(next);},[]);
  const awaiting = useRef<{ revision: Revision; selectedId: string|null; createdRoot?:string }|null>(null);
  const revisionRef = useRef(appliedRevision); revisionRef.current = appliedRevision;
  useEffect(() => { scope.current++; busyRef.current = false; setBusy(false); undo.current=[]; redo.current=[]; awaiting.current=null; queuedHistory.current=null; }, [boardId, doc, session?.session?.currentOrgId, session?.session?.userId]);
  useEffect(() => {
    const pending = awaiting.current, applied = appliedRevision;
    if (!pending || !applied || applied.epoch !== pending.revision.epoch || applied.seq < pending.revision.seq) return;
    awaiting.current=null; busyRef.current=false; setBusy(false);
    onSelection(pending.selectedId && readObjects(doc).some(object => object.id === pending.selectedId) ? [pending.selectedId] : []);
    if(pending.createdRoot)onCreatedRoot?.(pending.createdRoot);
    onNotice('思维导图已由服务器保存。');
    drainHistory();
  }, [doc, appliedRevision, onCreatedRoot, onSelection, onNotice, drainHistory]);
  useEffect(() => {
    const pending=awaiting.current;
    if(!pending)return;
    if(appliedRevision && appliedRevision.epoch!==pending.revision.epoch){awaiting.current=null;queuedHistory.current=null;busyRef.current=false;setBusy(false);onNotice('思维导图已提交，但白板恢复到了新版本，请刷新核对。');return;}
    const timer=setTimeout(()=>{if(awaiting.current===pending){awaiting.current=null;queuedHistory.current=null;busyRef.current=false;setBusy(false);onNotice('服务器已接受思维导图，当前同步尚未完成，请刷新核对；勿重复提交。');}},10_000);
    return()=>clearTimeout(timer);
  },[busy,pendingRevision,appliedRevision,onNotice]);
  const run = useCallback(async (action: MindmapAction) => {
    if (busyRef.current || readOnly || !session?.session || !revisionRef.current) return false;
    const revision = { ...revisionRef.current }, currentScope = scope.current;
    busyRef.current=true; setBusy(true); onNotice('正在保存思维导图…');
    try {
      const vector = mindmapStateVector(doc), plan = planBoardMindmap(readObjects(doc), action);
      const command = WhiteboardMindmapCommand.parse({ action: plan.action, treeId: plan.treeId, expectedStateVector: vector, commands: plan.commands });
      // Never optimistically apply a structural Yjs update. Authority holds the
      // board head lock and rejects stale revisions before publishing one batch.
      const receipt = await executeBoardOperation({ apiVersion:'2026-09-01', requestId:crypto.randomUUID(), boardId, expectedRevision:revision,
        actor:{kind:'human',actorId:session.session.userId,orgId:session.session.currentOrgId,role:role,scopes:['board:read','board:write'],delegatedBy:null},
        commands:command.commands, mindmap:command, provenance:{source:action.action==='import-mermaid'?'import':'human',model:null,skill:null,sourceArtifactId:null,sourceRevision:null,layoutHash:null,inputObjectIds:[],}, });
      if(scope.current!==currentScope)return false;
      undo.current.push(receipt); redo.current=[];
      const createdRoot=action.action==='create-root'||action.action==='import-mermaid'?plan.treeId:undefined;
      awaiting.current={revision:receipt.revision,selectedId:plan.selectedId,createdRoot};setPendingRevision(value=>value+1);
      const applied=revisionRef.current;
      if(applied?.epoch===receipt.revision.epoch&&applied.seq>=receipt.revision.seq){awaiting.current=null;onSelection(plan.selectedId?[plan.selectedId]:[]);busyRef.current=false;setBusy(false);if(createdRoot)onCreatedRoot?.(createdRoot);onNotice('思维导图已由服务器保存。');drainHistory();}
      return true;
    } catch(error) {
      if(scope.current===currentScope){queuedHistory.current=null;busyRef.current=false;setBusy(false);onNotice(error instanceof Error && (error.message.includes('CONFLICT') || error.message.includes('STALE'))?'思维导图未保存：其他成员已修改白板，请核对后重试。':`思维导图未保存：${error instanceof Error?error.message:'操作失败'}`);}
      return false;
    }
  }, [boardId, doc, readOnly, role, onCreatedRoot, onNotice, onSelection, session, drainHistory]);
  const history = useCallback(async (direction:'undo'|'redo') => {
    if(readOnly)return false;
    if(busyRef.current){queuedHistory.current??=direction;return true;}
    const source=direction==='undo'?undo:redo, target=direction==='undo'?redo:undo;
    const previous=source.current.at(-1);
    if(!previous)return false;
    if(!revisionRef.current)return true;
    const currentScope=scope.current;
    busyRef.current=true;setBusy(true);onNotice(direction==='undo'?'正在撤销思维导图…':'正在重做思维导图…');
    try{
      const receipt=WhiteboardOperationReceipt.parse(await apiRequest(`/v1/whiteboards/${encodeURIComponent(boardId)}/operations/${previous.operationId}/undo`,{method:'POST',body:{expectedRevision:previous.revision}}));
      if(scope.current!==currentScope)return true;
      source.current.pop();target.current.push(receipt);awaiting.current={revision:receipt.revision,selectedId:null};setPendingRevision(value=>value+1);
      const applied=revisionRef.current;if(applied?.epoch===receipt.revision.epoch&&applied.seq>=receipt.revision.seq){awaiting.current=null;busyRef.current=false;setBusy(false);onSelection([]);onNotice('思维导图历史操作已保存。');drainHistory();}
    }catch(error){if(scope.current===currentScope){queuedHistory.current=null;busyRef.current=false;setBusy(false);onNotice(`思维导图历史操作未应用：${error instanceof Error?error.message:'操作失败'}`);}}
    return true;
  }, [boardId,readOnly,onNotice,onSelection,drainHistory]);
  historyAction.current=history;
  return {busy,run,undo:()=>history('undo'),redo:()=>history('redo'),hasUndo:()=>{const last=undo.current.at(-1),revision=revisionRef.current;return Boolean(last&&revision&&last.revision.epoch===revision.epoch&&last.revision.seq===revision.seq);},hasRedo:()=>{const last=redo.current.at(-1),revision=revisionRef.current;return Boolean(last&&revision&&last.revision.epoch===revision.epoch&&last.revision.seq===revision.seq);}};
}
