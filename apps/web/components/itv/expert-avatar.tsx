"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AVATAR_CHANGED_EVENT, AVATAR_KEYS, defaultExpertAvatar, loadExpertAvatar, readExpertAvatar, saveExpertAvatar, type ExpertAvatarContext } from "@/lib/interview-expert-avatar";
import { getStoredSessionToken } from "@/lib/api-client";
import { AvatarIllustration } from "@/components/ui/avatar-illustration";

export { AvatarIllustration };

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(AVATAR_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(AVATAR_CHANGED_EVENT, onChange);
  };
}

function useExpertAvatar(expertId: string, context?: ExpertAvatarContext, loadPreference = true) {
  const token = getStoredSessionToken();
  const interviewId = context?.interviewId;
  const revisionId = context?.revisionId;
  React.useEffect(() => { if (loadPreference) void loadExpertAvatar(expertId, interviewId && revisionId ? { interviewId, revisionId } : undefined).catch(() => { /* Display deterministic fallback; explicit save reports errors. */ }); }, [expertId, token, interviewId, revisionId, loadPreference]);
  return React.useSyncExternalStore(subscribe, () => readExpertAvatar(expertId, context), () => defaultExpertAvatar(expertId));
}

export function ExpertAvatar({ expertId, displayName, className, context, loadPreference = true }: { expertId: string; displayName: string; className?: string; context?: ExpertAvatarContext; loadPreference?: boolean }) {
  const avatarKey = useExpertAvatar(expertId, context, loadPreference);
  return <span role="img" aria-label={`${displayName}的插画头像`} data-avatar-key={avatarKey} className={cn("inline-block size-11 shrink-0 overflow-hidden rounded-full text-foreground", className)}><AvatarIllustration avatarKey={avatarKey} /></span>;
}

export function ExpertAvatarEditor({ expertId, displayName, compact = false, context, disabled = false, disabledReason }: { expertId: string; displayName: string; compact?: boolean; context?: ExpertAvatarContext; disabled?: boolean; disabledReason?: string }) {
  const avatarKey = useExpertAvatar(expertId, context, !disabled);
  const [open, setOpen] = React.useState(false);
  const [selection, setSelection] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const authenticated = Boolean(getStoredSessionToken());
  return <div className="flex shrink-0 items-center gap-3">
    {!compact && <ExpertAvatar expertId={expertId} displayName={displayName} className="size-16" context={context} loadPreference={!disabled} />}
    <Button type="button" variant={compact ? "ghost" : "outline"} size={compact ? "icon" : "sm"} disabled={disabled} aria-label={`修改${displayName}头像`} title={disabledReason ?? "修改头像"} onClick={() => { setSelection(avatarKey); setError(""); setOpen(true); }}>{compact ? <ExpertAvatar expertId={expertId} displayName={displayName} className="size-9" context={context} loadPreference={!disabled} /> : "修改头像"}</Button>
    {disabled && disabledReason && <span className="text-xs text-muted-foreground">{disabledReason}</span>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg overflow-y-auto">
        <DialogTitle>修改{displayName}头像</DialogTitle>
        <DialogDescription>{authenticated ? "选择插画头像，保存到当前账号并跨会话同步。头像偏好不改变专家档案或访谈证据。" : "选择插画头像。未登录预览仅保存在当前浏览器。"}</DialogDescription>
        <div className="grid grid-cols-5 gap-2" role="group" aria-label="头像库">
          {AVATAR_KEYS.map((key, index) => <button key={key} type="button" aria-label={key === "robot" ? "机器人头像" : `人物头像 ${index + 1}`} aria-pressed={(selection ?? defaultExpertAvatar(expertId)) === key} onClick={() => setSelection(key)} className={cn("aspect-square rounded-xl border p-2 text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", (selection ?? defaultExpertAvatar(expertId)) === key ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}><AvatarIllustration avatarKey={key} /></button>)}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => setSelection(null)}>恢复默认</Button>
          <div className="flex gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>取消</Button><Button type="button" variant="primary" disabled={saving} onClick={async () => {
            setSaving(true); setError("");
            try { await saveExpertAvatar(expertId, selection, context); setOpen(false); }
            catch {
              await loadExpertAvatar(expertId, context).catch(() => undefined);
              setError("无法保存头像，请重新打开编辑器加载最新头像后重试。");
            }
            finally { setSaving(false); }
          }}>{saving ? "保存中…" : "保存头像"}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}
