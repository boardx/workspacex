"use client";
import { interviewCategoryText } from "@/lib/interview-category-text";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import { interviewMarkdown } from "@repo/contracts";
import { ArrowRight, Check, Plus, Search, Trash2, ArrowUp, ArrowDown, Pencil } from "lucide-react";
import type { DigitalExpertCatalogRow } from "@/lib/interview-api";
import type { InterviewMarkdownDocument } from "@/lib/interview-markdown-api";
import { Button } from "@/components/ui/button";
import { WorkflowActionButton as ActionButton } from "@/components/research-studio/research-workflow-actions";
import { InterviewExpertLibrary } from "./interview-expert-library";
import { InterviewStepHeader, InterviewStepActions } from "./interview-step-header";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ExpertAvatar, ExpertAvatarEditor } from "./expert-avatar";
import { InterviewReportMarkdown } from "./interview-report-markdown";
import { parseVirtualExpertProposal, parseVirtualExpertSelection, renderVirtualExpertMarkdown, renderVirtualExpertSelection, type VirtualExpertFields } from "@/lib/interview-virtual-expert";
import { INTERVIEW_PERSONAS, INTERVIEW_PERSONA_CATEGORIES, personaAnchorId } from "@/lib/interview-personas/persona-library";

const PAGE_SIZE = 9;
const emptyVirtualExpert = (): VirtualExpertFields => ({ name: "", role: "", domains: "", focus: "", style: "", bio: "", limits: "" });

function text(value: string) { return value.replace(/[\\[\]()*_`#<>]/gu, "\\$&").replace(/[\r\n]+/gu, " "); }
function SelectedAvatar({ id, name, directory, context, savedIds }: { id: string; name: string; directory: readonly DigitalExpertCatalogRow[]; context?: { interviewId: string; revisionId: string }; savedIds: readonly string[] }) {
  const virtual = !directory.some((expert) => expert.expertId === id);
  return <ExpertAvatarEditor expertId={id} displayName={name} compact context={virtual ? context : undefined} disabled={virtual && (!context || !savedIds.includes(id))} />;
}
export function InterviewExpertsStep({ document, directory, directoryStatus = "ready", onRetryDirectory, pending, loading = false, onChange, onConfirm, onSuggestVirtual, onSaveExpert, avatarContext, savedExpertIds = [], showRecoveryContext = false }: {
  document: InterviewMarkdownDocument; directory: readonly DigitalExpertCatalogRow[]; pending: boolean; loading?: boolean;
  directoryStatus?: "loading" | "ready" | "error"; onRetryDirectory?: () => void;
  onChange: (markdown: string) => void; onConfirm: () => void;
  /** Retained as optional compatibility inputs while the expert footer is intentionally single-action. */
  onSave?: () => void; onGenerate?: () => void;
  onSuggestVirtual?: (description: string) => Promise<string>;
  onSaveExpert?: (markdown: string) => Promise<void>;
  avatarContext?: { interviewId: string; revisionId: string };
  savedExpertIds?: readonly string[];
  showRecoveryContext?: boolean;
}) {
 const { t, locale } = useI18n();
  const [query, setQuery] = React.useState("");
  const [domain, setDomain] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState(false);
  const [description, setDescription] = React.useState("");
  const [fields, setFields] = React.useState<VirtualExpertFields>(emptyVirtualExpert);
  const [suggestPending, setSuggestPending] = React.useState(false);
  const [suggestError, setSuggestError] = React.useState<import("@/lib/i18n/messages").MessageKey | "">("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const dialogBase = React.useRef("");
  const currentDocumentStamp = JSON.stringify([document.documentId, document.version, document.contentHash, document.markdown, avatarContext?.revisionId]);
  const [savingExpert, setSavingExpert] = React.useState(false);
  const readyToSave = (() => { try { renderVirtualExpertMarkdown(fields); return true; } catch { return false; } })();
  function editField(field: keyof VirtualExpertFields, value: string) { setFields((current) => ({ ...current, [field]: value })); }
  async function suggestVirtual() {
    if (!onSuggestVirtual || !description.trim() || suggestPending) return;
    setSuggestPending(true); setSuggestError("");
    try { setFields(parseVirtualExpertProposal(await onSuggestVirtual(description.trim()))); }
    catch { setSuggestError("itv.experts.error.suggestFailed"); }
    finally { setSuggestPending(false); }
  }
  const projection = interviewMarkdown.parseInterviewMarkdown(document);
  const selected = projection.blocks.flatMap((block) => {
    const link = block.links.find((item) => /^#expert-[a-zA-Z0-9_-]+$/u.test(item.url));
    return link ? [{ block, id: link.url.slice(8), name: link.text }] : [];
  });
  function editExpert(entry: (typeof selected)[number]) {
    try {
      setFields(parseVirtualExpertSelection(entry.name, document.markdown.slice(entry.block.start, entry.block.end)));
      setEditingId(entry.id); setDescription(""); setSuggestError(""); dialogBase.current = currentDocumentStamp; setOpen(true);
    } catch { setSuggestError("itv.experts.error.parseFailed"); }
  }
  async function saveExpert() {
    if (savingExpert || pending || !readyToSave) return;
    if (dialogBase.current !== currentDocumentStamp) { setSuggestError("itv.experts.error.remoteChanged"); return; }
    const id = editingId ?? `virtual-${crypto.randomUUID()}`;
    const replacement = `## [${text(fields.name)}](#expert-${id})\n\n${renderVirtualExpertSelection(fields)}\n`;
    const existing = editingId ? selected.find(entry => entry.id === editingId) : undefined;
    if (editingId && !existing) { setSuggestError("itv.experts.error.expertChanged"); return; }
    const next = existing ? document.markdown.slice(0, existing.block.start) + replacement + document.markdown.slice(existing.block.end)
      : `${document.markdown}\n\n${replacement}`;
    setSavingExpert(true); setSuggestError("");
    try {
      if (onSaveExpert) await onSaveExpert(next);
      else onChange(next);
      setOpen(false);
    } catch (cause) { setSuggestError(cause instanceof Error && cause.message === "EXPERT_DRAFT_CONFLICT"
      ? "itv.experts.error.draftConflict"
      : "itv.experts.error.saveFailed"); }
    finally { setSavingExpert(false); }
  }
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = directory.filter((expert) => (!domain || expert.domains.includes(domain)) && `${expert.displayName} ${expert.role} ${expert.domains.join(" ")}`.toLocaleLowerCase().includes(normalizedQuery));
  const personas = INTERVIEW_PERSONAS.filter((persona) => (!domain || persona.category === domain) && `${persona.name} ${persona.specialty} ${persona.category} ${persona.bio}`.toLocaleLowerCase().includes(normalizedQuery));
  const pageCount = Math.max(1, Math.ceil(personas.length / PAGE_SIZE));
  const visiblePersonas = personas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const domains = Array.from(new Set([...INTERVIEW_PERSONA_CATEGORIES, ...directory.flatMap((expert) => expert.domains)]));
  function append(id: string, title: string, markdown: string) {
    onChange(`${document.markdown}\n\n## [${text(title)}](#expert-${id})\n\n${markdown}\n`);
  }
  function move(index: number, delta: number) {
    const first = selected[Math.min(index, index + delta)]?.block;
    const second = selected[Math.max(index, index + delta)]?.block;
    if (!first || !second) return;
    const raw = document.markdown;
    onChange(raw.slice(0, first.start) + raw.slice(second.start, second.end) + raw.slice(first.end, second.start) + raw.slice(first.start, first.end) + raw.slice(second.end));
  }
  return <div data-testid="itv-markdown-experts">
    <InterviewStepHeader title={t("itv.analysis.next")} />
    <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
      <section className="rounded-xl border border-border p-5"><h3 className="text-xl font-semibold">{t("itv.experts.library")}</h3>
        <div className="mt-4 flex flex-wrap gap-3"><label className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-input px-3"><Search className="size-4" aria-hidden /><input aria-label={t("itv.experts.search")} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={t("itv.experts.searchPlaceholder")} className="w-full bg-transparent py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label><select aria-label={t("itv.experts.domains")} value={domain} onChange={(event) => { setDomain(event.target.value); setPage(1); }} className="rounded-lg border border-input bg-background px-3 text-sm"><option value="">{t("itv.experts.allDomains")}</option>{domains.map((value) => <option key={value} value={value}>{interviewCategoryText(value, locale)}</option>)}</select></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map((expert) => { const isSelected = selected.some((entry) => entry.id === expert.expertId); return <article key={expert.expertId} data-testid={`itv-expert-card-${expert.expertId}`} data-selected={isSelected} className={`rounded-xl border p-4 transition-colors ${isSelected ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border"}`}><ExpertAvatarEditor expertId={expert.expertId} displayName={expert.displayName} compact /><h4 className="mt-3 font-semibold">{expert.displayName}</h4><p className="mt-1 text-xs text-muted-foreground">{expert.role}</p><p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{expert.bio}</p><Button className="mt-4" variant={isSelected ? "primary" : "outline"} disabled={pending || isSelected} aria-label={`${isSelected ? t("itv.experts.selectedNamed") : t("itv.experts.addNamed")} ${expert.displayName}`} onClick={() => append(expert.expertId, expert.displayName, `专业角色：${text(expert.role)}\n\n领域：${expert.domains.map(text).join("、")}\n\n${text(expert.bio)}\n\n材料边界：${text(expert.materialBoundary)}`)}>{isSelected ? <Check className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}{isSelected ? t("itv.experts.selected") : t("itv.experts.add")}</Button></article>; })}</div>
        {directoryStatus === "loading" ? <div data-testid="itv-expert-directory-loading" className="animate-pulse rounded-lg border border-border bg-muted/30 px-5 py-6 text-center text-sm text-muted-foreground">{t("itv.experts.directoryLoading")}</div> : directoryStatus === "error" ? <div data-testid="itv-expert-directory-error" role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-5 py-6 text-center"><p className="text-sm text-destructive">{t("itv.experts.directoryError")}</p><Button className="mt-4" variant="outline" onClick={onRetryDirectory}>{t("itv.experts.retryDirectory")}</Button></div> : !directory.length ? <div data-testid="itv-expert-directory-empty" className="mt-4 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">{t("itv.experts.directoryEmpty")}</div> : null}
        <div className="mt-5 border-t border-border pt-5"><div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-lg font-semibold">{t("itv.library.simulated")}</h4><span className="text-sm text-muted-foreground">{t("itv.experts.profileCount", { count: personas.length })}</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("itv.experts.personaHint")}</p></div>
        {personas.length ? <><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visiblePersonas.map((persona) => { const id = personaAnchorId(persona); const isSelected = selected.some((entry) => entry.id === id); return <article key={persona.id} data-testid={`itv-persona-card-${id}`} data-selected={isSelected} className={`rounded-xl border bg-card p-4 transition-colors ${isSelected ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border"}`}><div className="flex items-start gap-3"><ExpertAvatar expertId={id} displayName={persona.name} className="size-10" loadPreference={false} /><div className="min-w-0"><h5 className="font-semibold">{persona.name}</h5><p className="text-xs text-muted-foreground">{persona.specialty}</p></div></div><p className="mt-2 text-xs text-muted-foreground">{persona.category} · {t("itv.experts.simulated")}</p><p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{persona.bio}</p><Button className="mt-3" variant={isSelected ? "primary" : "outline"} disabled={pending || isSelected} aria-label={`${isSelected ? t("itv.experts.selectedProfile") : t("itv.library.select")} ${persona.name}`} onClick={() => append(id, persona.name, `画像类型：模拟画像；不是组织已发布专家或真人访谈证据。\n\n专业角色：${text(persona.specialty)}\n\n领域：${text(persona.category)}\n\n背景（画像设定，未经独立核实）：${text(persona.bio)}\n\n研究目标：${persona.goals.map(text).join("；")}\n\n关注议题：${persona.interests.map(text).join("；")}\n\n主要痛点：${persona.pain_points.map(text).join("；")}\n\n典型建议（画像设定）：${text(persona.typical_advice)}\n\n材料边界：该内容来自静态模拟画像库，仅用于模拟研究，不可作为独立真人证据。`)}>{isSelected ? <Check className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}{isSelected ? t("itv.experts.selected") : t("itv.library.select")}</Button></article>; })}</div><div className="mt-4 flex items-center justify-end gap-3 text-sm"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{t("itv.experts.previousProfiles")}</Button><span>{t("itv.experts.page", { page, total: pageCount })}</span><Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>{t("itv.experts.nextProfiles")}</Button></div></> : !visible.length ? <div className="py-8 text-center text-sm text-muted-foreground"><p>{t("itv.experts.noMatchShort")}</p><p className="mt-1">{t("itv.experts.adjustSearch")}</p></div> : null}
      </section>
      <aside className="rounded-xl border border-border p-5"><h3 className="text-xl font-semibold">{t("itv.experts.selectedCount", { count: selected.length })}</h3><div className="mt-4 space-y-3">{selected.map((entry, index) => <article key={entry.id} className="rounded-lg border border-border p-3"><div className="flex items-center gap-2"><SelectedAvatar id={entry.id} name={entry.name} directory={directory} context={avatarContext} savedIds={savedExpertIds} /><strong className="min-w-0 flex-1 text-sm">{entry.name}</strong>{entry.id.startsWith("virtual-") && <Button variant="ghost" size="icon" disabled={pending} aria-label={t("itv.experts.edit", { name: entry.name })} onClick={() => editExpert(entry)}><Pencil className="size-4" aria-hidden /></Button>}<Button variant="ghost" size="icon" disabled={pending} aria-label={t("itv.experts.remove", { name: entry.name })} onClick={() => onChange(document.markdown.slice(0, entry.block.start) + document.markdown.slice(entry.block.end))}><Trash2 className="size-4" aria-hidden /></Button></div><div className="mt-2 flex gap-2"><Button variant="ghost" size="sm" disabled={pending || index === 0} aria-label={t("itv.experts.up", { name: entry.name })} onClick={() => move(index, -1)}><ArrowUp className="size-4" aria-hidden /></Button><Button variant="ghost" size="sm" disabled={pending || index === selected.length - 1} aria-label={t("itv.experts.down", { name: entry.name })} onClick={() => move(index, 1)}><ArrowDown className="size-4" aria-hidden /></Button></div></article>)}</div></aside>
    </div>
    <InterviewExpertLibrary includeBuiltins={false} allowCreate={false} disabled={pending} onSelect={async(id,name,body)=>{if(selected.some(entry=>entry.id===id))return;const next=`${document.markdown}\n\n## [${text(name)}](#expert-${id})\n\n${body}\n`;if(onSaveExpert)await onSaveExpert(next);else onChange(next);}}/>
    {showRecoveryContext && document.markdown.trim() ? <section data-testid="itv-expert-draft-context" className="mt-4 rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground"><h3 className="font-semibold text-foreground">{t("itv.experts.recoveryTitle")}</h3><p className="mt-1">{t("itv.experts.recoveryHint")}</p><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 font-mono text-xs leading-6">{document.markdown}</pre></section> : !selected.length && document.markdown.trim() ? <p data-testid="itv-expert-draft-context" className="mt-4 rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">{t("itv.experts.savedDraft", { content: document.markdown.slice(0, 160) })}</p> : null}
    {suggestError && !open && <p role="alert" className="mt-3 text-sm text-destructive">{t(suggestError)}</p>}
    <InterviewStepActions><ActionButton variant="outline" icon={<Plus className="size-4" aria-hidden />} disabled={pending} onClick={() => { setEditingId(null); setDescription(""); setFields(emptyVirtualExpert()); setSuggestError(""); dialogBase.current = currentDocumentStamp; setOpen(true); }}>{t("itv.experts.addVirtual")}</ActionButton><ActionButton variant="primary" loading={loading} icon={<ArrowRight className="size-4" aria-hidden />} disabled={pending || !selected.length} onClick={onConfirm}>{t("itv.experts.confirm")}</ActionButton></InterviewStepActions>
    <Dialog open={open} onOpenChange={(value) => { if (!savingExpert) setOpen(value); }}><DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto p-6">
      <div className="flex items-center gap-4"><ExpertAvatar expertId="virtual-preview" displayName={fields.name || t("itv.experts.virtual")} /><div><DialogTitle className="text-2xl">{editingId ? t("itv.experts.editVirtual") : t("itv.experts.addVirtual")}</DialogTitle><DialogDescription className="mt-1 text-sm leading-6">{t("itv.experts.virtualDescription")}</DialogDescription></div></div>
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
        <section className="space-y-4 rounded-xl border border-border p-5">
          <h3 className="text-lg font-semibold">{t("itv.experts.describeTitle")}</h3>
          <label className="block text-sm font-medium">{t("itv.experts.describe")}<textarea aria-label={t("itv.experts.describe")} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("itv.experts.describePlaceholder")} className="mt-2 min-h-24 w-full rounded-lg border border-input bg-background p-3 font-normal leading-6" /></label>
          <Button variant="outline" disabled={!onSuggestVirtual || pending || suggestPending || savingExpert || !description.trim()} onClick={() => void suggestVirtual()}>{suggestPending ? t("itv.experts.suggesting") : t("itv.experts.suggest")}</Button>
          {suggestError && <p role="alert" className="text-sm text-destructive">{t(suggestError)}</p>}
          {([ ["name", t("itv.experts.name")], ["role", t("itv.field.role")], ["domains", t("itv.field.domains")], ["focus", t("itv.field.focus")], ["style", t("itv.field.style")], ["bio", t("itv.experts.bio")], ["limits", t("itv.field.limits")] ] as const).map(([field, label]) => <label key={field} className="block text-sm font-medium">{label}<textarea aria-label={label} disabled={pending || savingExpert || suggestPending} value={fields[field]} onChange={(event) => editField(field, event.target.value)} rows={field === "bio" || field === "limits" ? 3 : 1} className="mt-2 w-full rounded-lg border border-input bg-background p-3 font-normal leading-6" /></label>)}
          <p className="text-xs leading-5 text-muted-foreground">{t("itv.experts.proposalBoundary")}</p>
        </section>
        <aside data-testid="itv-virtual-expert-preview-card" className="rounded-xl border border-border bg-muted/20 p-5">
          <h3 className="text-lg font-semibold">{t("itv.experts.previewTitle")}</h3>
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-card p-3"><ExpertAvatar expertId="virtual-preview" displayName={fields.name || t("itv.experts.virtual")} /><div className="min-w-0"><strong className="block truncate">{fields.name || t("itv.experts.unnamed")}</strong><span className="text-xs text-muted-foreground">{t("itv.experts.simulatedOnly")}</span></div></div>
          {readyToSave ? <InterviewReportMarkdown markdown={renderVirtualExpertMarkdown(fields)} testId="itv-virtual-expert-preview" /> : <p className="mt-5 text-sm leading-6 text-muted-foreground">{t("itv.experts.previewHint")}</p>}
          <p className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">{t("itv.experts.boundaryHint")}</p>
        </aside>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={savingExpert} onClick={() => setOpen(false)}>{t("itv.cancel")}</Button><Button variant="primary" disabled={pending || savingExpert || suggestPending || !readyToSave} onClick={() => void saveExpert()}>{savingExpert ? t("studio.saving") : editingId ? t("itv.experts.saveEdits") : t("itv.experts.saveAdd")}</Button></div>
    </DialogContent></Dialog>
  </div>;
}
