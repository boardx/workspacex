"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AVATAR_CHANGED_EVENT, AVATAR_KEYS, defaultExpertAvatar, readExpertAvatar, saveExpertAvatar } from "@/lib/interview-expert-avatar";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(AVATAR_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(AVATAR_CHANGED_EVENT, onChange);
  };
}

function useExpertAvatar(expertId: string) {
  return React.useSyncExternalStore(subscribe, () => readExpertAvatar(expertId), () => defaultExpertAvatar(expertId));
}

/** Small, first-party SVGs; no remote image requests or untrusted SVG injection. */
export function AvatarIllustration({ avatarKey }: { avatarKey: string }) {
  const index = avatarKey === "robot" ? 0 : Number(avatarKey.slice(7)) - 1;
  const hair = index % 6;
  const accessory = Math.floor(index / 6);
  return <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className="size-full">
    <circle cx="32" cy="32" r="31" fill="currentColor" opacity=".08" />
    {avatarKey === "robot" ? <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M32 13v6M15 30h-3v11h3M49 30h3v11h-3" />
      <rect x="17" y="21" width="30" height="27" rx="9" fill="currentColor" opacity=".15" />
      <rect x="17" y="21" width="30" height="27" rx="9" />
      <circle cx="26" cy="32" r="2" fill="currentColor" /><circle cx="38" cy="32" r="2" fill="currentColor" />
      <path d="M26 40h12M23 54h18" />
    </g> : <>
      <path d="M9 61c1-14 9-21 23-21s22 7 23 21" fill="currentColor" opacity={accessory === 3 ? ".45" : ".22"} />
      <path d="M27 38v7l5 5 5-5v-7" fill="currentColor" opacity=".12" />
      {hair >= 3 && <path d="M15 24c0-18 34-18 34 0v24H15Z" fill="currentColor" opacity=".65" />}
      <ellipse cx="32" cy="28" rx="13" ry="16" className="fill-background" />
      <ellipse cx="32" cy="28" rx="13" ry="16" fill="currentColor" opacity=".12" />
      {hair === 0 && <path d="M18 25c-2-18 26-21 29-3l-3 7-3-12-17 5-4 8Z" fill="currentColor" opacity=".8" />}
      {hair === 1 && <path d="M18 25c-3-20 29-22 29 0l-9-10-18 15Z" fill="currentColor" opacity=".8" />}
      {hair === 2 && <path d="M19 23c0-16 26-16 26 0l-6-8-14 1Z" fill="currentColor" opacity=".65" />}
      {hair === 3 && <path d="M17 26c0-18 30-18 30 0L34 14 19 32Z" fill="currentColor" opacity=".8" />}
      {hair === 4 && <path d="M18 25c-3-18 31-20 29 0l-8-8-7 7-8-6Z" fill="currentColor" opacity=".8" />}
      {hair === 5 && <><circle cx="32" cy="10" r="7" fill="currentColor" opacity=".8" /><path d="M18 25c0-19 29-19 28 0L33 15Z" fill="currentColor" opacity=".8" /></>}
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M26 28h1M37 28h1M29 36q3 2 6 0" />
        {accessory === 1 && <><rect x="22" y="24" width="9" height="8" rx="3" /><rect x="33" y="24" width="9" height="8" rx="3" /><path d="M31 27h2" /></>}
        {accessory === 2 && <path d="M23 34q0 9 9 9t9-9M28 34h8" />}
        {accessory === 3 && <path d="m25 45 7 6 7-6M32 51v10" />}
      </g>
    </>}
  </svg>;
}

export function ExpertAvatar({ expertId, displayName, className }: { expertId: string; displayName: string; className?: string }) {
  const avatarKey = useExpertAvatar(expertId);
  return <span role="img" aria-label={`${displayName}的插画头像`} data-avatar-key={avatarKey} className={cn("inline-block size-11 shrink-0 overflow-hidden rounded-full text-foreground", className)}><AvatarIllustration avatarKey={avatarKey} /></span>;
}

export function ExpertAvatarEditor({ expertId, displayName, compact = false }: { expertId: string; displayName: string; compact?: boolean }) {
  const avatarKey = useExpertAvatar(expertId);
  const [open, setOpen] = React.useState(false);
  const [selection, setSelection] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  return <div className="flex shrink-0 items-center gap-3">
    {!compact && <ExpertAvatar expertId={expertId} displayName={displayName} className="size-16" />}
    <Button type="button" variant={compact ? "ghost" : "outline"} size={compact ? "icon" : "sm"} aria-label={`修改${displayName}头像`} title="修改头像" onClick={() => { setSelection(avatarKey); setError(""); setOpen(true); }}>{compact ? <ExpertAvatar expertId={expertId} displayName={displayName} className="size-9" /> : "修改头像"}</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg overflow-y-auto">
        <DialogTitle>修改{displayName}头像</DialogTitle>
        <DialogDescription>选择插画头像。仅保存在当前浏览器，不跨设备同步，不改变专家档案或访谈证据。</DialogDescription>
        <div className="grid grid-cols-5 gap-2" role="group" aria-label="头像库">
          {AVATAR_KEYS.map((key, index) => <button key={key} type="button" aria-label={key === "robot" ? "机器人头像" : `人物头像 ${index + 1}`} aria-pressed={(selection ?? defaultExpertAvatar(expertId)) === key} onClick={() => setSelection(key)} className={cn("aspect-square rounded-xl border p-2 text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", (selection ?? defaultExpertAvatar(expertId)) === key ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}><AvatarIllustration avatarKey={key} /></button>)}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => setSelection(null)}>恢复默认</Button>
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="button" variant="primary" onClick={() => {
            try { saveExpertAvatar(expertId, selection); setOpen(false); }
            catch { setError("无法保存头像，请检查浏览器存储权限或空间后重试。"); }
          }}>保存头像</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}
