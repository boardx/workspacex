import {
  operations, EntityLocalizationAdminView, EntityDisplaySource,
  type EntityKind, type EntityLocalizationWrite, type EntityLocalizationClear, type EntitySourceLocaleWrite,
  LocalizedEntityDisplay,
} from "@repo/contracts/entity-localization";
import type { Locale } from "@repo/contracts/locale";
import { apiRequest } from "./api-client";

type DisplayField = keyof LocalizedEntityDisplay["fields"];
export const ENTITY_LOCALIZATION_UPDATED = "workspacex:entity-localization-updated";
export function notifyUpdated(kind: EntityKind, entityId: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ENTITY_LOCALIZATION_UPDATED, { detail: { kind, entityId } }));
}
export function translatedText(display: LocalizedEntityDisplay | undefined, field: DisplayField): string | null {
  const parsed = LocalizedEntityDisplay.safeParse(display);
  if (!parsed.success || parsed.data.requestedLocale === parsed.data.sourceLocale) return null;
  const resolved = parsed.data.fields[field];
  return !resolved.fallback && typeof resolved.value === "string" && resolved.value.trim() !== "" ? resolved.value : null;
}
export function localizedText(display: LocalizedEntityDisplay | undefined, field: DisplayField, fallback: string): string;
export function localizedText(display: LocalizedEntityDisplay | undefined, field: DisplayField, fallback: string | null): string | null;
export function localizedText(display: LocalizedEntityDisplay | undefined, field: DisplayField, fallback: string | null): string | null {
  // Preserve existing source formatters (including built-in stable-ID → authored name mapping).
  return translatedText(display, field) ?? fallback;
}
function path(template: string, entityId: string, locale?: Locale) {
  return template.replace(":entityId", encodeURIComponent(entityId)).replace(":locale", encodeURIComponent(locale ?? ""));
}
export async function getEntityLocalization(kind: EntityKind, entityId: string, locale: Locale, signal?: AbortSignal) {
  const operation = operations[kind].get;
  return EntityLocalizationAdminView.parse(await apiRequest(path(operation.path, entityId, locale), { method: operation.method, signal }));
}
export async function putEntityLocalization(kind: EntityKind, entityId: string, locale: Locale, input: EntityLocalizationWrite) {
  const operation = operations[kind].put;
  const view = EntityLocalizationAdminView.parse(await apiRequest(path(operation.path, entityId, locale), { method: operation.method, body: operation.in.parse(input) }));
  notifyUpdated(kind, entityId); return view;
}
export async function clearEntityLocalization(kind: EntityKind, entityId: string, locale: Locale, input: EntityLocalizationClear) {
  const operation = operations[kind].clear;
  const view = EntityLocalizationAdminView.parse(await apiRequest(path(operation.path, entityId, locale), { method: operation.method, body: operation.in.parse(input) }));
  notifyUpdated(kind, entityId); return view;
}
export async function setEntitySourceLocale(kind: EntityKind, entityId: string, input: EntitySourceLocaleWrite) {
  const operation = operations[kind].sourceLocale;
  const source = EntityDisplaySource.parse(await apiRequest(path(operation.path, entityId), { method: operation.method, body: operation.in.parse(input) }));
  notifyUpdated(kind, entityId); return source;
}
