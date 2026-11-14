'use client';

import { useEffect, useState } from 'react';
import { useOptionalSession } from '@/components/session/session-provider';
import { listOrgMembers, type ListOrgMembersOut } from '@/lib/live-org-admin';
import { listBoardMembers, putBoardMember, type BoardMember } from '@/lib/live-whiteboard';

const roleLabels = { viewer: '可查看', commenter: '可评论', editor: '可编辑' };
import { Link2, Users } from 'lucide-react';
import { whiteboard as C } from '@repo/contracts';
import { apiRequest } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const days = C.BOARD_SHARE_TTL_MS / 86_400_000;

export function BoardShareDialog({ boardId, canManage }: { boardId: string; canManage?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!canManage) return null;
  return <Dialog open={open} onOpenChange={setOpen}>
    <Button data-testid="board-share-open" aria-label="分享白板" title="分享白板" className="min-h-11 min-w-11 shrink-0 gap-2 rounded-xl" variant="primary" onClick={() => setOpen(true)}>
      <Users className="h-4 w-4" /><span className="hidden md:inline">分享</span>
    </Button>
    {open && <BoardShareContent key={boardId} boardId={boardId} />}
  </Dialog>;
}

function BoardShareContent({ boardId }: { boardId: string }) {
  const session = useOptionalSession()?.session;
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      const result = C.CreatedBoardShare.parse(await apiRequest(C.sharePaths.create.replace(':boardId', encodeURIComponent(boardId)), { method: 'POST' }));
      const url = `${window.location.origin}/share/board/${encodeURIComponent(result.token)}`;
      setLink({ url, expiresAt: result.expiresAt });
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      } catch {
        setError('无法自动复制，请手动复制下方链接。');
      }
    } catch {
      setError('无法生成分享链接，请重试。');
    } finally {
      setBusy(false);
    }
  }

  return <DialogContent data-testid="board-share-dialog">
    <DialogTitle>分享白板</DialogTitle>
    <DialogDescription>任何拿到链接的人都可以查看白板，无需登录。链接自生成起 {days} 天内有效。</DialogDescription>
    {link && <label className="grid gap-1 text-13">只读链接
      <input className="w-full rounded-md border border-border bg-background p-2" readOnly value={link.url} onFocus={event => event.currentTarget.select()} />
      <span className="text-muted-foreground">到期时间：{new Date(link.expiresAt).toLocaleString()}</span>
    </label>}
    {error && <p role="alert">{error}</p>}
    {copied && <p role="status">链接已复制</p>}
    <Button data-testid="board-share-copy" disabled={busy} onClick={() => void generate()}>
      <Link2 className="mr-2 h-4 w-4" />{busy ? '正在生成…' : link ? '生成并复制新链接' : '生成并复制链接'}
    </Button>
    {session && <details className="border-t border-border pt-3">
      <summary className="cursor-pointer text-13">管理组织成员权限</summary>
      <MemberAccess key={JSON.stringify([session.currentOrgId, session.userId])} boardId={boardId}
        orgId={session.currentOrgId} ownerId={session.userId} />
    </details>}
  </DialogContent>;
}

function MemberAccess({ boardId, orgId, ownerId }: {
  boardId: string; orgId?: string; ownerId?: string;
}) {
  const [members, setMembers] = useState<BoardMember[]>();
  const [directory, setDirectory] = useState<ListOrgMembersOut['members']>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<BoardMember['role']>('viewer');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void listBoardMembers(boardId).then(items => {
      if (active) setMembers(items);
    }).catch(() => {
      if (active) setLoadError('暂时无法读取成员权限。复制链接不会新增访问权限。');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [boardId]);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    void listOrgMembers(orgId).then(({ members: items }) => {
      if (active) setDirectory(items.filter(member => member.userId !== ownerId && member.status === 'active'));
    }).catch(() => {
      if (active) setLoadError('暂时无法读取组织成员，请重新打开分享窗口。');
    });
    return () => { active = false; };
  }, [orgId, ownerId]);

  async function grant() {
    if (saving || !members || !directory?.some(member => member.userId === userId)) return;
    const member = { userId, role };
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await putBoardMember(boardId, member);
      setMembers(current => [...(current ?? []).filter(item => item.userId !== userId), member]);
      setNotice('权限已保存，现在可以把白板链接发给对方。');
    } catch {
      setError('授权失败，请确认对方仍是组织成员后重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {loading && <p role="status">正在读取成员权限…</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {members && <p className="text-13 text-muted-foreground">已授权 {members.length} 位协作者（不含白板所有者）。</p>}
      {orgId && members && directory && (directory.length ? (
        <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void grant(); }}>
          <label className="grid gap-1">组织成员
            <select className="h-10 rounded-md border border-border bg-background px-2" value={userId} disabled={saving} onChange={event => {
              const selectedId = event.target.value;
              setUserId(selectedId);
              setRole(members.find(member => member.userId === selectedId)?.role ?? 'viewer');
              setNotice('');
              setError('');
            }}>
              <option value="">选择成员</option>
              {directory.map(member => <option key={member.userId} value={member.userId}>{member.displayName ? `${member.displayName} · ${member.email}` : member.email}</option>)}
            </select>
          </label>
          <label className="grid gap-1">白板权限
            <select className="h-10 rounded-md border border-border bg-background px-2" value={role} disabled={saving} onChange={event => {
              setRole(event.target.value as BoardMember['role']);
              setNotice('');
            }}>
              {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <Button type="submit" disabled={!userId || saving}>{saving ? '正在保存…' : '保存权限'}</Button>
        </form>
      ) : <p className="text-13 text-muted-foreground">暂无可分享的组织成员。请先邀请对方加入组织。</p>)}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
