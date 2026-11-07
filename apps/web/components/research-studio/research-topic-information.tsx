"use client";
import { RESEARCH_FOCUS_OPTIONS as focusOptions } from "@/lib/research-focus-options";
import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import { Check } from "lucide-react";
import { research as C } from "@repo/contracts";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";

type Brief = GuidedResearchRuntime["brief"];
const goalLimit = C.GuidedResearchBrief.shape.goal.maxLength!;
const focusLimit = C.GuidedResearchBrief.shape.focus.maxLength!;

const focusLabelKeys = ["research.focus.0", "research.focus.1", "research.focus.2", "research.focus.3", "research.focus.4", "research.focus.5", "research.focus.6", "research.focus.7", "research.focus.8", "research.focus.9"] as const;
const customFocus = (focus: string) => focus.split(/[、，,；;\n]/).map((item) => item.trim()).filter((item) => item && !focusOptions.includes(item)).join("\n");

export function ResearchTopicInformation({ brief, disabled, onSave, onDirtyChange }: { brief: Brief; disabled: boolean; onSave: (value: Brief) => void | boolean | Promise<boolean | void>; onDirtyChange?: (dirty: boolean) => void }) {
  const { t } = useI18n();
  const [value, setValue] = React.useState(brief);
  const [other, setOther] = React.useState(() => customFocus(brief.focus));
  const [saved, setSaved] = React.useState(() => JSON.stringify(brief));
  const [status, setStatus] = React.useState<"idle" | "editing" | "saving" | "saved" | "failed">("idle");
  const valueRef = React.useRef(value);
  valueRef.current = value;
  const saveRef = React.useRef(onSave);
  saveRef.current = onSave;
  const previousServerBrief = React.useRef(brief);
  React.useEffect(() => {
    if (JSON.stringify(previousServerBrief.current) !== JSON.stringify(brief)) {
      const unchanged = JSON.stringify(valueRef.current) === JSON.stringify(previousServerBrief.current);
      previousServerBrief.current = brief;
      if (unchanged) { setValue(brief); setOther(customFocus(brief.focus)); setSaved(JSON.stringify(brief)); }
    }
  }, [brief]);
  const selected = value.focus.split(/[、，,；;\n]/).map((item) => item.trim()).filter(Boolean);
  const focusTooLong = value.focus.length > focusLimit;
  const valid = C.GuidedResearchBrief.safeParse(value).success;
  const changed = JSON.stringify(value) !== saved;
  React.useEffect(() => { onDirtyChange?.(changed); }, [changed, onDirtyChange]);
  React.useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);
  const inFlight = React.useRef(false);
  const save = React.useCallback(async () => {
    if (inFlight.current || disabled || !valid || !changed) return;
    const submitted = valueRef.current;
    inFlight.current = true; setStatus("saving");
    try {
      const result = await saveRef.current(submitted);
      if (result === false) { setStatus("failed"); return; }
      setSaved(JSON.stringify(submitted));
      setStatus(JSON.stringify(valueRef.current) === JSON.stringify(submitted) ? "saved" : "editing");
    } catch { setStatus("failed"); }
    finally { inFlight.current = false; }
  }, [disabled, valid, changed]);
  React.useEffect(() => {
    if (!changed || !valid || disabled || status === "saving" || status === "failed") return;
    const timer = window.setTimeout(() => { void save(); }, 800);
    return () => window.clearTimeout(timer);
  }, [value, changed, valid, disabled, status, save]);
  const field = (name: keyof Brief, text: string) => { setValue((current) => ({ ...current, [name]: text })); setStatus((current) => current === "saving" ? current : "editing"); };
  return <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="research-topic-information">
    <div className="space-y-1"><label htmlFor="research-topic" className="text-sm font-semibold">{t("research.intake.topic")} <span className="text-destructive">*</span></label><Input id="research-topic" aria-label={t("research.intake.topic")} className="h-9 text-sm" maxLength={200} value={value.topic} disabled={disabled} onChange={(event) => field("topic", event.target.value)} /></div>
    <div className="space-y-1"><label htmlFor="research-goal" className="text-sm font-semibold">{t("research.intake.goal")} <span className="text-destructive">*</span></label><div className="relative"><Textarea id="research-goal" className="min-h-20 pb-6 text-sm leading-snug" maxLength={goalLimit} value={value.goal} disabled={disabled} onChange={(event) => field("goal", event.target.value)} /><p className="pointer-events-none absolute bottom-2 right-3 text-xs text-muted-foreground">{value.goal.length} / {goalLimit}</p></div></div>
    <fieldset className="space-y-2" disabled={disabled}><legend className="mb-1 text-sm font-semibold">{t("research.topic.focus")}</legend><div className="flex flex-wrap gap-1.5">{focusOptions.map((option, index) => <label key={option} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${selected.includes(option) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}><input type="checkbox" className="peer sr-only" checked={selected.includes(option)} onChange={(event) => field("focus", [...(event.target.checked ? [...selected.filter((item) => focusOptions.includes(item)), option] : selected.filter((item) => focusOptions.includes(item) && item !== option)), other].filter(Boolean).join("、"))} /><span className="flex size-4 items-center justify-center rounded-full border border-current peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2" aria-hidden>{selected.includes(option) && <Check className="size-3" />}</span>{t(focusLabelKeys[index]!)}</label>)}</div><div className="space-y-1"><label htmlFor="research-other" className="text-sm font-semibold">{t("research.topic.other")}</label><Textarea id="research-other" aria-label={t("research.topic.other")} aria-invalid={focusTooLong} aria-describedby={focusTooLong ? "research-focus-error" : undefined} rows={3} className="min-h-20 text-sm" placeholder={t("research.topic.otherPlaceholder")} value={other} maxLength={focusLimit} onChange={(event) => { setOther(event.target.value); field("focus", [...selected.filter((item) => focusOptions.includes(item)), event.target.value].filter(Boolean).join("、")); }} /></div>{focusTooLong && <p id="research-focus-error" role="alert" className="text-xs text-destructive">{t("research.topic.focusLimit", { count: focusLimit })}</p>}</fieldset>
    {status !== "idle" && <div className="flex items-center justify-end gap-2"><p role="status" className="text-xs text-muted-foreground">{status === "saving" ? t("research.topic.saving") : status === "failed" ? t("research.topic.failed") : changed ? t("research.topic.unsaved") : t("state.saved")}</p>{status === "failed" && <Button type="submit" variant="outline" disabled={disabled || !valid}>{t("research.topic.retry")}</Button>}</div>}
  </form>;
}
