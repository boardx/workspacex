'use client';

import { useEffect, useState } from 'react';
import { Link2, Users } from 'lucide-react';
import { useOptionalSession } from '@/components/session/session-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { listOrgMembers, type ListOrgMembersOut } from '@/lib/live-org-admin';
import { listBoardMembers, putBoardMember, type BoardMember } from '@/lib/live-whiteboard';

const roleLabels = { viewer: '可查看', commenter: '可评论', editor: '可编辑' };

export function BoardShareDialog({ boardId, canManage }: { boardId: string; canManage?: boolean }) {
  const session = useOptionalSession()?.session;
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button data-testid="board-share-open" aria-label="分享白板" title="分享白板" className="min-h-11 min-w-11 shrink-0 gap-2 rounded-xl" variant="primary" onClick={() => setOpen(true)}>
        <Users className="h-4 w-4" /><span className="hidden md:inline">分享</span>
      </Button>
      {open && <BoardShareContent key={JSON.stringify([boardId, session?.currentOrgId, session?.userId])} boardId={boardId}
        orgId={canManage ? session?.currentOrgId : undefined} ownerId={session?.userId} showCount={canManage !== false} />}
    </Dialog>
  );
}

function BoardShareContent({ boardId, orgId, ownerId, showCount }: {
  boardId: string; orgId?: string; ownerId?: string; showCount: boolean;
}) {
  const [members, setMembers] = useState<BoardMember[]>();
  const [directory, setDirectory] = useState<ListOrgMembersOut['members']>();
  const [loading, setLoading] = useState(showCount);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<BoardMember['role']>('viewer');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!showCount) return;
    let active = true;
    void listBoardMembers(boardId).then(items => {
      if (active) setMembers(items);
    }).catch(() => {
      if (active) setLoadError('暂时无法读取成员权限。复制链接不会新增访问权限。');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [boardId, showCount]);

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
    <DialogContent data-testid="board-share-dialog">
      <DialogTitle>分享白板</DialogTitle>
      <DialogDescription>只有已获授权的成员能够打开这个链接。{orgId ? '请先选择组织成员并保存权限。' : '如需访问，请联系白板所有者授权。'}</DialogDescription>
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
      <Button data-testid="board-share-copy" onClick={async () => {
        setCopied(false);
        setError('');
        try {
          await navigator.clipboard.writeText(`${window.location.origin}/studio/board/${encodeURIComponent(boardId)}`);
          setCopied(true);
        } catch {
          setError('无法复制链接，请从浏览器地址栏复制。');
        }
      }}>
        <Link2 className="mr-2 h-4 w-4" />{copied ? '链接已复制' : '复制白板链接'}
      </Button>
    </DialogContent>
  );
}
