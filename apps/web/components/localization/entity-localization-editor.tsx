"use client";
import * as React from "react";
import type { EntityKind, EntityLocalizationAdminView, LocalizedEntityDisplay } from "@repo/contracts/entity-localization";
import { ENTITY_LOCALIZATION_TEXT_LIMIT } from "@repo/contracts/entity-localization";
import { SUPPORTED_LOCALES, type Locale } from "@repo/contracts/locale";
import { useI18n } from "@/lib/i18n/provider";
import { isLocale } from "@/lib/i18n/locale";
import { useOptionalSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import { ENTITY_LOCALIZATION_COPY } from "@/lib/entity-localization-copy";
import { getEntityLocalization, putEntityLocalization, clearEntityLocalization, setEntitySourceLocale } from "@/lib/entity-localization";

type Field = keyof LocalizedEntityDisplay["fields"];
type Values = Partial<Record<Field, string>>;
type Failure = "denied" | "missing" | "conflict" | "loadFailed" | "saveFailed";
type Notice = "saved" | "cleared" | "sourceSaved";
const SKILL_DISPLAY_FIELDS: readonly Field[] = ["name", "summary", "duty"];
const AGENT_DISPLAY_FIELDS: readonly Field[] = ["name", "roleLabel", "duty", "avatarAlt"];
function editableFields(kind: EntityKind): readonly Field[] {
  return kind === "skill" ? SKILL_DISPLAY_FIELDS : AGENT_DISPLAY_FIELDS;
}
interface Draft { sourceRevision: string; values: Values; published: boolean }
type State = { key: string; view: EntityLocalizationAdminView | null; loading: boolean; failure: Failure | null };
function failureOf(error: unknown, fallback: Failure): Failure {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return "denied";
    if (error.status === 404) return "missing";
    if (error.status === 409) return "conflict";
  }
  return fallback;
}
function valuesOf(view: EntityLocalizationAdminView, kind: EntityKind): Values {
  return Object.fromEntries(editableFields(kind).map(field => [field, view.translation?.fields[field] ?? ""]));
}
function languageLabel(language: Locale, locale: Locale) {
  return new Intl.DisplayNames([locale], { type: "language" }).of(language) ?? language;
}

/** Load administrative content only after the user opens its existing-page entry. */
export function EntityLocalizationPanel(props: { kind: EntityKind; entityId: string; onSaved?: () => void }) {
  const { locale } = useI18n();
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return <div className="space-y-3"><Button type="button" size="sm" variant="secondary" data-testid="entity-localization-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{ENTITY_LOCALIZATION_COPY[locale].open}</Button>{open && <div id={id}><EntityLocalizationEditor {...props} /></div>}</div>;
}

export function EntityLocalizationEditor({ kind, entityId, onSaved }: { kind: EntityKind; entityId: string; onSaved?: () => void }) {
  const { locale } = useI18n();
  const copy = ENTITY_LOCALIZATION_COPY[locale];
  const context = useOptionalSession();
  const identityKey = context ? `${context.status}:${context.session?.userId ?? ""}:${context.session?.currentOrgId ?? ""}:${context.identity?.orgRole ?? ""}:${context.identity?.org.team ?? ""}` : "standalone";
  const canLoad = !context || context.status === "authenticated";
  const [targetLocale, setTargetLocale] = React.useState<Locale>(locale);
  const key = `${identityKey}:${kind}:${entityId}:${targetLocale}`;
  const keyRef = React.useRef(key); keyRef.current = key;
  const [state, setState] = React.useState<State>({ key, view: null, loading: true, failure: null });
  const [values, setValues] = React.useState<Values>({});
  const [published, setPublished] = React.useState(true);
  const [sourceLocale, setSourceLocale] = React.useState<Locale | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const [reload, setReload] = React.useState(0);
  const drafts = React.useRef(new Map<string, Draft>());
  const chosenTarget = React.useRef(false);
  const inputId = React.useId();
  React.useEffect(() => { drafts.current.clear(); }, [identityKey]);
  React.useEffect(() => {
    const abort = new AbortController();
    setBusy(false); setNotice(null);
    setState({ key, view: null, loading: canLoad, failure: canLoad ? null : "denied" });
    if (!canLoad) return;
    void getEntityLocalization(kind, entityId, targetLocale, abort.signal).then(view => {
      if (abort.signal.aborted || keyRef.current !== key) return;
      if (!chosenTarget.current && view.source.locale === targetLocale) {
        const other = SUPPORTED_LOCALES.find(language => language !== targetLocale);
        if (other) { setTargetLocale(other); return; }
      }
      const cached = drafts.current.get(key);
      const currentDraft = cached?.sourceRevision === view.source.revision ? cached : null;
      setValues(currentDraft?.values ?? valuesOf(view, kind));
      setPublished(currentDraft?.published ?? (view.translation ? view.translation.status === "reviewed" : true));
      setDirty(currentDraft !== null);
      setSourceLocale(view.source.locale);
      setState({ key, view, loading: false, failure: null });
    }, error => {
      if (!abort.signal.aborted && keyRef.current === key) setState({ key, view: null, loading: false, failure: failureOf(error, "loadFailed") });
    });
    return () => abort.abort();
  }, [key, kind, entityId, targetLocale, canLoad, reload]);
  const view = state.key === key ? state.view : null;
  const loading = state.key !== key || state.loading;
  const remember = (nextValues: Values, nextPublished = published) => {
    if (!view) return;
    setValues(nextValues); setPublished(nextPublished); setDirty(true); setNotice(null);
    drafts.current.set(key, { sourceRevision: view.source.revision, values: nextValues, published: nextPublished });
  };
  const accept = (next: EntityLocalizationAdminView, nextNotice: Notice) => {
    if (keyRef.current !== key) return;
    drafts.current.delete(key); setDirty(false); setValues(valuesOf(next, kind));
    setPublished(next.translation ? next.translation.status === "reviewed" : true);
    setState({ key, view: next, loading: false, failure: null }); setNotice(nextNotice); onSaved?.();
  };
  const mutate = async (action: "save" | "clear" | "source") => {
    if (!view || busy) return;
    setBusy(true); setNotice(null); setState(previous => ({ ...previous, failure: null }));
    try {
      if (action === "source") {
        await setEntitySourceLocale(kind, entityId, { expectedSourceRevision: view.source.revision, locale: sourceLocale });
        if (keyRef.current === key) { drafts.current.delete(key); setReload(value => value + 1); onSaved?.(); }
      } else if (action === "clear") {
        if (view.translation) accept(await clearEntityLocalization(kind, entityId, targetLocale, {
          sourceRevision: view.source.revision, expectedTranslationRevision: view.translation.revision,
        }), "cleared");
      } else {
        accept(await putEntityLocalization(kind, entityId, targetLocale, {
          sourceRevision: view.source.revision, expectedTranslationRevision: view.translation?.revision ?? null,
          status: published ? "reviewed" : "draft", fields: values,
        }), "saved");
      }
    } catch (error) {
      if (keyRef.current === key) setState(previous => ({ ...previous, failure: failureOf(error, "saveFailed") }));
    } finally { if (keyRef.current === key) setBusy(false); }
  };
  const sameSource = view?.source.locale === targetLocale;
  const hasTranslation = view?.translation && Object.values(view.translation.fields).some(value => typeof value === "string" && value.trim() !== "");
  const options = SUPPORTED_LOCALES.map(language => ({ value: language, label: languageLabel(language, locale) }));
  return (
    <section data-testid="entity-localization-editor" className="space-y-4 rounded-lg border border-border bg-card p-4" aria-busy={busy || loading}>
      <header><h3 className="text-13 font-semibold text-card-foreground">{copy.title}</h3><p className="mt-1 text-12 text-muted-foreground">{copy.description}</p></header>
      {loading && <p className="text-12 text-muted-foreground">{copy.loading}</p>}
      {state.key === key && state.failure && <div role="alert" className="space-y-2 text-12 text-destructive"><p>{copy[state.failure]}</p><Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => { drafts.current.delete(key); setReload(value => value + 1); }}>{copy.retry}</Button></div>}
      {view && <>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><p className="text-12 font-medium">{copy.sourceLanguage}</p><Select aria-label={copy.sourceLanguage} options={[{ value: "", label: copy.unknown }, ...options]} value={sourceLocale ?? ""} disabled={busy} onValueChange={value => setSourceLocale(isLocale(value) ? value : null)} /></div>
          <Button type="button" size="sm" variant="secondary" disabled={busy || dirty || sourceLocale === view.source.locale} onClick={() => void mutate("source")}>{copy.saveSource}</Button>
        </div>
        <p className="text-11 text-muted-foreground">{dirty ? copy.finishEdit : copy.sourceHint}</p>
        <div className="space-y-1"><p className="text-12 font-medium">{copy.targetLanguage}</p><Select aria-label={copy.targetLanguage} options={options} value={targetLocale} disabled={busy} onValueChange={value => { if (isLocale(value)) { chosenTarget.current = true; setTargetLocale(value); } }} /></div>
        {sameSource && <p className="text-12 text-muted-foreground">{copy.sameSource}</p>}
        {editableFields(kind).map(field => <div key={field} className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1"><label htmlFor={`${inputId}-${field}-source`} className="text-12 font-medium">{copy.fields[field]} {copy.original}</label><Textarea id={`${inputId}-${field}-source`} readOnly value={view.source.fields[field] ?? ""} placeholder={copy.notProvided} rows={field === "name" || field === "roleLabel" ? 2 : 3} className="bg-muted" /></div>
          <div className="space-y-1"><label htmlFor={`${inputId}-${field}-translation`} className="text-12 font-medium">{copy.fields[field]} {copy.translation}</label><Textarea id={`${inputId}-${field}-translation`} data-testid={`entity-localization-${field}`} value={values[field] ?? ""} disabled={busy || sameSource} maxLength={ENTITY_LOCALIZATION_TEXT_LIMIT} rows={field === "name" || field === "roleLabel" ? 2 : 3} placeholder={copy.blank} onChange={event => remember({ ...values, [field]: event.target.value })} /></div>
        </div>)}
        <Checkbox checked={published} disabled={busy || sameSource} label={copy.publish} onChange={event => remember(values, event.target.checked)} />
        <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy || sameSource || !dirty} onClick={() => void mutate("save")}>{busy ? copy.saving : copy.save}</Button><Button type="button" size="sm" variant="secondary" disabled={busy || !hasTranslation} onClick={() => void mutate("clear")}>{copy.clear}</Button></div>
      </>}
      {notice && <p role="status" className="text-12 text-muted-foreground">{copy[notice]}</p>}
    </section>
  );
}
