'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type * as Y from 'yjs';
import { createWhiteboardDocument } from '@repo/whiteboard-core';
import { exportBoardPackage, getBoard, importBoardPackage, previewBoardImport, type Board } from '@/lib/live-whiteboard';
import { whiteboardTransfer as T } from '@repo/contracts';
import { WhiteboardProvider, type WhiteboardConnectionState } from '@/lib/whiteboard-provider';
import { CollaborativeEditor } from './collaborative-editor';
import { useOptionalSession } from '@/components/session/session-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
const initial: WhiteboardConnectionState = { phase: 'connecting', pending: 0, role: 'viewer', archived: false, peers: [], reason: null };
export function LiveBoard({ boardId }: { boardId: string }) {
  const router = useRouter();
  const session = useOptionalSession();
  const providerRef = useRef<WhiteboardProvider | null>(null);
  const awareness = useCallback((cursor: {x:number;y:number}|null, selected:string[]) => providerRef.current?.awareness(cursor,selected), []);
  const [board, setBoard] = useState<Board | null>(null), [doc, setDoc] = useState<Y.Doc | null>(null);
  const [state, setState] = useState(initial), [failed, setFailed] = useState(false);
  const [transferOpen,setTransferOpen]=useState(false), [transferInput,setTransferInput]=useState<T.ImportBoardInput|null>(null);
  const [preview,setPreview]=useState<T.ImportBoardPreview|null>(null), [transferError,setTransferError]=useState(''), [transferring,setTransferring]=useState(false);
  useEffect(() => {
    let active = true; const document = createWhiteboardDocument(); let provider: WhiteboardProvider | undefined;
    setDoc(null); setBoard(null); setFailed(false); setState(initial);
    void getBoard(boardId).then(resource => {
      if (!active) return; setBoard(resource); setDoc(document);
      provider = new WhiteboardProvider(document, boardId, value => { if (active) setState(value); });
      providerRef.current = provider;
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; provider?.close(); if(providerRef.current===provider)providerRef.current=null; document.destroy(); };
  }, [boardId]);
  useEffect(() => {
    if (!state.pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [state.pending]);
  const back = () => { if (!state.pending || window.confirm('仍有未确认保存的修改，离开会丢失这些修改。确定离开？')) router.push('/studio/board'); };
  const download = async () => {
    try {
      const bundle=await exportBoardPackage(boardId), blob=new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob);
      const anchor=document.createElement('a');anchor.href=url;anchor.download=`${bundle.source.name.replace(/[^\p{L}\p{N}._-]+/gu,'-') || 'board'}.workspacex-board.json`;anchor.click();URL.revokeObjectURL(url);
    } catch { setTransferError('导出失败，请确认权限和网络后重试。'); setTransferOpen(true); }
  };
  const chooseImport = async (file: File | undefined) => {
    setTransferError('');setPreview(null);setTransferInput(null);if(!file)return;
    try {
      if(file.size>T.PORTABLE_BOARD.maxBytes)throw new Error();
      const bundle=T.PortableBoardPackage.parse(JSON.parse(await file.text()));
      const input=T.ImportBoardInput.parse({requestId:crypto.randomUUID(),package:bundle});
      setTransferInput(input);setPreview(await previewBoardImport(input));setTransferOpen(true);
    } catch { setTransferError('文件不是受支持的 WorkspaceX Board 包，或已超过大小限制。');setTransferOpen(true); }
  };
  const confirmImport = async () => {
    if(!transferInput)return;setTransferring(true);setTransferError('');
    try { const result=await importBoardPackage(transferInput);setTransferOpen(false);router.push(`/studio/board/${result.board.id}`); }
    catch { setTransferError('导入未应用，原白板和现有内容均未改变。请检查文件后重试。'); }
    finally { setTransferring(false); }
  };
  if (failed || state.phase === 'blocked') return <section data-testid="denied" className="p-6"><h1 className="text-20 font-semibold">无法继续访问白板</h1><p className="my-3 text-14">权限、会话或同步状态已改变。请返回列表确认后重新打开。未确认的修改不能视为已保存。</p><Button onClick={back}>返回白板列表</Button></section>;
  if (!doc || !board) return <p data-testid="loading" role="status" className="p-6">正在读取白板…</p>;
  const status = state.phase === 'connecting' ? '正在连接' : state.phase === 'offline' ? `连接中断 · ${state.pending} 项修改待保存` : state.pending ? `${state.pending} 项修改待保存` : '已同步';
  return <div className="flex h-full min-h-0 flex-col"><div className="flex items-center gap-2 border-b border-border bg-warning-tint px-3 py-1 text-12 text-warning-tint-foreground"><span>未确认保存的修改仅保存在当前页面，关闭或刷新后会丢失。在线成员 {state.peers.length}</span><Button data-testid="board-export" size="sm" variant="outline" className="ml-auto" onClick={()=>void download()}>导出</Button><label className="cursor-pointer rounded-control border border-border bg-background px-3 py-1 text-background-foreground"><span>导入副本</span><input data-testid="board-import-file" className="sr-only" type="file" accept="application/json,.json" onChange={event=>void chooseImport(event.target.files?.[0])}/></label></div><div className="min-h-0 flex-1"><CollaborativeEditor doc={doc} title={board.name} status={status} readOnly={state.phase === 'connecting' || state.role === 'viewer' || state.archived} onBack={back} currentUserId={session?.session?.userId} peers={state.peers} onAwareness={awareness}/></div><Dialog open={transferOpen} onOpenChange={setTransferOpen}><DialogContent><DialogTitle>导入为新的白板副本</DialogTitle>{transferError?<DialogDescription role="alert">{transferError}</DialogDescription>:preview?<><DialogDescription>将创建“{preview.destinationName}”，不会替换当前白板。全部 {preview.objectCount} 个对象会获得新身份，包括 {preview.frameCount} 个 Frame、{preview.groupCount} 个组和 {preview.connectorCount} 条连接。</DialogDescription><p className="text-13">内容损失：{preview.contentLosses.length ? preview.contentLosses.map(loss=>loss.message).join('；') : '无'}</p><Button data-testid="board-import-confirm" disabled={transferring} onClick={()=>void confirmImport()}>{transferring?'正在导入…':'确认创建副本'}</Button></>:<DialogDescription>请选择受支持的 Board JSON 包。</DialogDescription>}</DialogContent></Dialog></div>;
}
