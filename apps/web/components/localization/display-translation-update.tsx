"use client";
import * as React from "react";
import type { z } from "zod";
import type { DisplayUpdateOffer } from "@repo/contracts/portable-package";
import { useSession } from "@/components/session/session-provider";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { getDisplayUpdateOffer, applyDisplayUpdate } from "@/lib/authored-display-update";
const COPY = {
  "zh-CN": { title: "显示译文更新", description: "更新官方数字人与技能的中英文名称。手工维护的译文会保留。", action: "更新显示译文", busy: "正在更新…", checking: "正在检查显示译文更新…", done: "显示译文已更新。", error: "未能更新显示译文，请重试。", conflict: "更新内容已变化，请重新加载后重试。", reload: "重新加载" },
  en: { title: "Display translation update", description: "Update Chinese and English names for official colleagues and skills. Your manually maintained translations are preserved.", action: "Update display translations", busy: "Updating…", checking: "Checking display translation updates…", done: "Display translations updated.", error: "Could not update display translations. Please retry.", conflict: "The update changed. Reload before retrying.", reload: "Reload" },
} as const;
export function DisplayTranslationUpdate({ canUpdate, onUpdated, refreshKey = 0 }: { canUpdate: boolean; onUpdated: () => void; refreshKey?: number }) {
  const { status,session,identity } = useSession(), { locale } = useI18n(), copy = COPY[locale];
  const ready = canUpdate && status === "authenticated" && identity?.orgRole === "admin" && session !== null;
  const current = React.useRef({ session,identity,ready }); current.current = { session,identity,ready };
  const abort = React.useRef<AbortController | null>(null), busy = React.useRef(false);
  const attempt = React.useRef<{ orgId: string; version: string; key: string } | null>(null);
  const [offer,setOffer] = React.useState<z.infer<typeof DisplayUpdateOffer> | null>(null);
  const [loading,setLoading] = React.useState(false), [saving,setSaving] = React.useState(false), [done,setDone] = React.useState(false);
  const [failure,setFailure] = React.useState<"error" | "conflict" | null>(null), [reload,setReload] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller; busy.current = false;
    attempt.current = null;
    setOffer(null); setSaving(false); setDone(false); setFailure(null);
    if (!ready || !session) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    getDisplayUpdateOffer(session.sessionToken,controller.signal).then(value => { if (!controller.signal.aborted) setOffer(value); },
      () => { if (!controller.signal.aborted) setFailure("error"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  },[ready,session,identity,reload,refreshKey]);
  async function update() {
    if (!ready || !session || !offer?.available || busy.current) return;
    const captured = { session,identity }, controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    const active = () => !controller.signal.aborted && current.current.ready && current.current.session === captured.session && current.current.identity === captured.identity;
    if (!attempt.current || attempt.current.orgId !== session.currentOrgId || attempt.current.version !== offer.metadataVersion)
      attempt.current = { orgId: session.currentOrgId,version: offer.metadataVersion,key: crypto.randomUUID() };
    busy.current = true; setSaving(true); setFailure(null);
    try {
      await applyDisplayUpdate(offer.metadataVersion,attempt.current.key,{ orgId: session.currentOrgId,sessionToken: session.sessionToken,signal: controller.signal });
      if (!active()) return;
      setDone(true); setOffer({ ...offer,available: false }); onUpdated();
    } catch (error) { if (active()) setFailure(error instanceof ApiError && error.status === 409 ? "conflict" : "error"); }
    finally { if (active()) { busy.current = false; setSaving(false); } }
  }
  if (!ready || (!loading && !failure && !done && !offer?.available)) return null;
  return <section aria-label={copy.title} className="flex flex-col gap-2 rounded-card border border-border p-3" data-testid="display-translation-update">
    <h3 className="text-14 font-medium">{copy.title}</h3><p className="text-12 text-muted-foreground">{copy.description}</p>
    {loading ? <p role="status">{copy.checking}</p> : null}
    {done ? <p role="status">{copy.done}</p> : null}
    {failure ? <div role="alert"><p>{copy[failure]}</p><Button type="button" variant="outline" onClick={() => setReload(value => value+1)}>{copy.reload}</Button></div> : null}
    {offer?.available && failure !== "conflict" ? <Button type="button" disabled={saving} onClick={() => void update()}>{saving ? copy.busy : copy.action}</Button> : null}
  </section>;
}
