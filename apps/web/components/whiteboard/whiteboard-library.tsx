'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { whiteboard as C } from '@repo/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import * as api from '@/lib/live-whiteboard';
import { RESERVED_STATE_TESTID } from '@/lib/ui-state';

type Failure = { kind: 'denied' | 'dep-failed' | 'invalid'; message: string };
function failure(error: unknown): Failure {
  if (error instanceof ApiError && [401, 403, 404].includes(error.status)) return { kind: 'denied', message: '无法访问这块白板或成员。请确认当前账号、组织与授权后刷新。' };
  if (error instanceof ApiError && error.status === 400) return { kind: 'invalid', message: '提交内容未通过校验，请检查名称或成员账号。' };
  return { kind: 'dep-failed', message: '暂时无法完成请求，请稍后重试。' };
}
export function WhiteboardLibrary() {
  const [items, setItems] = useState<api.Board[]>([]), [selected, setSelected] = useState<api.Board | null>(null);
  const [members, setMembers] = useState<api.BoardMember[]>([]), [name, setName] = useState(''), [rename, setRename] = useState('');
  const [userId, setUserId] = useState(''), [role, setRole] = useState<api.BoardMember['role']>('viewer');
  const [busy, setBusy] = useState(true), [loaded, setLoaded] = useState(false), [error, setError] = useState<Failure | null>(null), [notice, setNotice] = useState('');
  const pendingCreate = useRef<api.CreateBoardInput | null>(null);
  const lock = useRef(false);
  const run = useCallback(async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null); setNotice('');
    try { await work(); } catch (e) { setError(failure(e)); }
    finally { lock.current = false; setBusy(false); }
  }, []);
  const refresh = useCallback(() => run(async () => {
    setSelected(null); setMembers([]);
    setItems(await api.listBoards()); setLoaded(true);
  }), [run]);
  useEffect(() => { void refresh(); }, [refresh]);
  const accept = (board: api.Board) => {
    setSelected(board); setRename(board.name);
    setItems(old => [board, ...old.filter(item => item.id !== board.id)]);
  };
  const open = (id: string) => run(async () => {
    setSelected(null); setMembers([]);
    const board = await api.getBoard(id); accept(board);
    if (board.role === 'owner') setMembers(await api.listBoardMembers(id));
  });
  const create = () => {
    if (!C.Board.shape.name.safeParse(name).success) { setError({ kind: 'invalid', message: '请输入 1–200 字的白板名称。' }); return; }
    if (!pendingCreate.current) pendingCreate.current = { requestId: crypto.randomUUID(), name: name.trim() };
    void run(async () => {
      let board: api.Board;
      try { board = await api.createBoard(pendingCreate.current!); }
      catch (e) {
        // A definite validation rejection can be corrected; uncertain writes keep their key.
        if (e instanceof ApiError && e.status === 400) pendingCreate.current = null;
        throw e;
      }
      pendingCreate.current = null; setName(''); setMembers([]); accept(board); setLoaded(true);
      setNotice('白板资源已创建。');
    });
  };
  const save = (input: api.UpdateBoardInput) => {
    if (!selected) return;
    if (!C.UpdateBoard.safeParse(input).success) { setError({ kind: 'invalid', message: '请输入 1–200 字的白板名称。' }); return; }
    void run(async () => { accept(await api.updateBoard(selected.id, input)); setNotice('白板信息已保存。'); });
  };
  return <section data-testid="whiteboard-library" className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-center gap-3"><div className="flex-1"><h1 className="text-24 font-semibold">Board</h1><p className="text-14 text-muted-foreground">组织中的白板，默认仅创建者可见。</p></div><Link href="/projects" className="text-14 underline">返回工作区</Link><Button data-testid="board-refresh" disabled={busy} onClick={() => void refresh()}>刷新列表</Button></header>
    <p className="rounded-container bg-muted p-3 text-13 text-muted-foreground">当前支持白板名称、归档和成员权限管理。画布编辑与多人协作尚未接入，便利贴与图形不会保存在这里。{process.env.NODE_ENV !== 'production' && <> <Link href="/preview/whiteboard" className="underline">打开交互预览</Link></>}</p>
    {busy && <p data-testid={RESERVED_STATE_TESTID.loading} role="status">正在处理白板请求…</p>}
    {error && <p data-testid={error.kind === 'invalid' ? 'err-board-form' : RESERVED_STATE_TESTID[error.kind]} role="alert" className="rounded-control bg-destructive p-3 text-destructive-foreground">{error.message}</p>}
    {notice && <p data-testid={RESERVED_STATE_TESTID.success} role="status">{notice}</p>}
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); create(); }}><label className="min-w-0 flex-1 text-13">新白板名称<Input data-testid="board-create-name" value={name} maxLength={200} disabled={busy || !!pendingCreate.current} onChange={e => setName(e.target.value)} /></label><Button type="submit" data-testid="board-create" disabled={busy}>{pendingCreate.current ? '重试创建' : '创建白板'}</Button></form>
    {loaded && !busy && items.length === 0 && <p data-testid={RESERVED_STATE_TESTID.empty}>还没有可访问的白板。创建你的第一块白板。</p>}
    <div className="grid gap-3 md:grid-cols-2">{items.map(board => <Button key={board.id} data-testid={`board-open-${board.id}`} variant="outline" disabled={busy} className="h-auto min-w-0 justify-between whitespace-normal p-4 text-left" onClick={() => void open(board.id)}><span className="break-words">{board.name}</span><span className="text-12 text-muted-foreground">{board.archived ? '已归档' : '使用中'} · {board.role === 'owner' ? '所有者' : board.role === 'editor' ? '编辑者' : '查看者'}</span></Button>)}</div>
    {selected && <section data-testid="board-detail" className="space-y-4 rounded-container border border-border bg-card p-4"><h2 className="text-20 font-semibold">{selected.name}</h2><p className="break-all text-12 text-muted-foreground">白板 ID：{selected.id}</p><p className="text-13">资源信息已从服务端读取。此页面尚未提供画布编辑。</p>
      {selected.role === 'owner' ? <><form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); save({ name: rename }); }}><label className="flex-1 text-13">白板名称<Input data-testid="board-rename-name" value={rename} maxLength={200} disabled={busy} onChange={e => setRename(e.target.value)} /></label><Button type="submit" data-testid="board-rename" disabled={busy}>保存名称</Button><Button data-testid="board-archive" disabled={busy} onClick={() => save({ archived: !selected.archived })}>{selected.archived ? '恢复白板' : '归档白板'}</Button></form>
      <h3 className="text-16 font-semibold">成员权限</h3><p className="text-12 text-muted-foreground">仅可添加当前组织成员。请输入其用户 ID，非邮箱或显示名称。</p><form className="flex flex-wrap items-end gap-2" onSubmit={e => {
        e.preventDefault(); const member = C.Member.safeParse({ userId: userId.trim(), role });
        if (!member.success) { setError({ kind: 'invalid', message: '请输入有效的成员用户 ID。' }); return; }
        void run(async () => { await api.putBoardMember(selected.id, member.data); setMembers(await api.listBoardMembers(selected.id)); setUserId(''); setNotice('成员权限已保存。'); });
      }}><label className="min-w-0 flex-1 text-13">成员用户 ID<Input data-testid="board-member-user" disabled={busy} value={userId} onChange={e => setUserId(e.target.value)} /></label><label className="text-13">角色<select data-testid="board-member-role" className="block rounded-control border border-border bg-background p-2 text-14" disabled={busy} value={role} onChange={e => setRole(e.target.value as api.BoardMember['role'])}><option value="viewer">查看者</option><option value="editor">编辑者</option></select></label><Button type="submit" data-testid="board-member-save" disabled={busy}>保存权限</Button></form>
      <ul className="space-y-2">{members.map(member => <li key={member.userId} className="flex flex-wrap items-center gap-2 text-14"><span className="break-all">{member.userId} · {member.role === 'editor' ? '编辑者' : '查看者'}</span><Button data-testid={`board-member-remove-${member.userId}`} disabled={busy} variant="outline" onClick={() => void run(async () => { await api.removeBoardMember(selected.id, member.userId); setMembers(await api.listBoardMembers(selected.id)); setNotice('成员权限已撤销。'); })}>撤销权限</Button></li>)}</ul></> : <p className="text-13 text-muted-foreground">只有白板所有者可以修改名称、归档及管理成员。</p>}
    </section>}
  </section>;
}
