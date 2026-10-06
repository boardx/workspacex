"use client";
import * as React from "react";
import { auth } from "@repo/contracts";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateOrganizationDialog({ open, onOpenChange, create, onSelect }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  create: (name: string, requestId: string) => Promise<{ orgId: string; orgName: string }>;
  onSelect: (orgId: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<{ orgId: string; orgName: string } | null>(null);
  const request = React.useRef<{ name: string; id: string } | null>(null);
  const submitting = React.useRef(false);
  const close = (next: boolean) => {
    if (submitting.current) return;
    // Keep an uncertain request across cancel/reopen so retry cannot create a duplicate.
    if (!next && (created || !request.current)) {
      request.current = null; setName(""); setCreated(null); setError(null);
    }
    onOpenChange(next);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    const input = auth.operations.createOrganization.in.safeParse({ orgName: name, requestId: request.current?.id ?? crypto.randomUUID() });
    if (!input.success) { setError("请输入 1–100 个字符的组织名称。"); return; }
    request.current ??= { name: input.data.orgName, id: input.data.requestId };
    submitting.current = true; setBusy(true); setError(null);
    try {
      setCreated(await create(request.current.name, request.current.id));
    } catch {
      setError("创建未完成，请重试。重试会使用同一请求，避免重复创建组织。");
    } finally {
      submitting.current = false; setBusy(false);
    }
  };
  return <Dialog open={open} onOpenChange={close}>
    <DialogContent hideClose={busy} data-testid="create-organization-dialog">
      <DialogTitle>{created ? "组织已创建" : "新建组织"}</DialogTitle>
      <DialogDescription>{created ? `已创建「${created.orgName}」，可从组织列表切换进入。` : "使用当前账号创建独立组织，你将成为组织管理员。"}</DialogDescription>
      {created ? <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => close(false)}>完成</Button>
        <Button onClick={() => { const id = created.orgId; close(false); onSelect(id); }}>切换到新组织</Button>
      </div> : <form onSubmit={(event) => { void submit(event); }} className="space-y-4">
        <label className="block space-y-2 text-13" htmlFor="new-organization-name">
          <span>组织名称</span>
          <Input id="new-organization-name" data-testid="new-organization-name" value={name} maxLength={100}
            disabled={busy || request.current !== null} autoFocus onChange={(event) => setName(event.target.value)} aria-describedby={error ? "organization-create-error" : undefined} />
        </label>
        {error && <p id="organization-create-error" role="alert" className="text-13 text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => close(false)}>取消</Button>
          <Button type="submit" disabled={busy} data-testid="create-organization-submit">{busy ? "创建中…" : error && request.current ? "重试" : "创建组织"}</Button>
        </div>
      </form>}
    </DialogContent>
  </Dialog>;
}
