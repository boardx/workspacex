"use client";
import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AVATAR_CHANGED_EVENT, ILLUSTRATION_AVATAR_KEYS, defaultExpertAvatar, loadExpertAvatar, readExpertAvatar, saveExpertAvatar, type ExpertAvatarContext } from "@/lib/interview-expert-avatar";
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
 const { t } = useI18n();
  const avatarKey = useExpertAvatar(expertId, context, loadPreference);
  return <span role="img" aria-label={t("itv.avatar.image", { name: displayName })} data-avatar-key={avatarKey} className={cn("inline-block size-11 shrink-0 overflow-hidden rounded-full text-foreground", className)}><AvatarIllustration avatarKey={avatarKey} /></span>;
}

export function ExpertAvatarEditor({ expertId, displayName, compact = false, context, disabled = false, disabledReason }: { expertId: string; displayName: string; compact?: boolean; context?: ExpertAvatarContext; disabled?: boolean; disabledReason?: string }) {
 const { t } = useI18n();
  const avatarKey = useExpertAvatar(expertId, context, !disabled);
  const [open, setOpen] = React.useState(false);
  const [selection, setSelection] = React.useState<string | null>(null);
  const [error, setError] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const authenticated = Boolean(getStoredSessionToken());
  return <div className="flex shrink-0 items-center gap-3">
    {!compact && <ExpertAvatar expertId={expertId} displayName={displayName} className="size-16" context={context} loadPreference={!disabled} />}
    <Button type="button" variant={compact ? "ghost" : "outline"} size={compact ? "icon" : "sm"} disabled={disabled} aria-label={t("itv.avatar.changeNamed", { name: displayName })} title={disabledReason ?? t("itv.avatar.change")} onClick={() => { setSelection(avatarKey); setError(false); setOpen(true); }}>{compact ? <ExpertAvatar expertId={expertId} displayName={displayName} className="size-9" context={context} loadPreference={!disabled} /> : t("itv.avatar.change")}</Button>
    {disabled && disabledReason && <span className="text-xs text-muted-foreground">{disabledReason}</span>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg overflow-y-auto">
        <DialogTitle>{t("itv.avatar.changeNamed", { name: displayName })}</DialogTitle>
        <DialogDescription>{authenticated ? t("itv.avatar.accountHint") : t("itv.avatar.previewHint")}</DialogDescription>
        <div className="grid grid-cols-5 gap-2" role="group" aria-label={t("itv.avatar.library")}>
          {ILLUSTRATION_AVATAR_KEYS.map((key, index) => <button key={key} type="button" aria-label={key === "robot" ? t("itv.avatar.robot") : t("itv.avatar.person", { count: index + 1 })} aria-pressed={(selection ?? defaultExpertAvatar(expertId)) === key} onClick={() => setSelection(key)} className={cn("aspect-square rounded-xl border p-2 text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", (selection ?? defaultExpertAvatar(expertId)) === key ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}><AvatarIllustration avatarKey={key} /></button>)}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{t("itv.avatar.failed")}</p>}
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => setSelection(null)}>{t("itv.avatar.reset")}</Button>
          <div className="flex gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>{t("itv.cancel")}</Button><Button type="button" variant="primary" disabled={saving} onClick={async () => {
            setSaving(true); setError(false);
            try { await saveExpertAvatar(expertId, selection, context); setOpen(false); }
            catch {
              await loadExpertAvatar(expertId, context).catch(() => undefined);
              setError(true);
            }
            finally { setSaving(false); }
          }}>{saving ? t("studio.saving") : t("itv.avatar.save")}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}
