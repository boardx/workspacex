import { z } from "zod";
import { Locale } from "./locale";

const Revision = z.string().trim().min(1).max(255);
export const ENTITY_LOCALIZATION_TEXT_LIMIT = 4000;
// Existing originals may exceed the authoring budget; retain them verbatim on reads.
const Text = z.string().nullable();
const TranslationText = Text.refine(value => value === null || value.length <= ENTITY_LOCALIZATION_TEXT_LIMIT, "translation exceeds character limit")
  .transform((value) => value === null || value.trim() === "" ? null : value);
export const EntityKind = z.enum(["skill", "agent"]);
export type EntityKind = z.infer<typeof EntityKind>;
export const LocalizationStatus = z.enum(["draft", "reviewed"]);

const SourceFields = z.object({
  name: z.string(),
  summary: Text.default(null),
  duty: Text.default(null),
  roleLabel: Text.default(null),
  avatarAlt: Text.default(null),
}).strict();
function displayShape<T extends z.ZodTypeAny>(schema: T): Record<keyof typeof SourceFields.shape, T> {
  return Object.fromEntries(Object.keys(SourceFields.shape).map((key) => [key, schema])) as Record<keyof typeof SourceFields.shape, T>;
}
/** Only display text is writable here. No instructions, policies, IDs or file content. */
export const LocalizationFields = z.object(displayShape(TranslationText.optional())).strict();
export const EntityDisplaySource = z.object({
  orgId: z.string().min(1), entityId: z.string().min(1), kind: EntityKind,
  revision: Revision, versionId: z.string().nullable().default(null), locale: Locale.nullable(), fields: SourceFields,
}).strict();
export const EntityLocalization = z.object({
  orgId: z.string().min(1), entityId: z.string().min(1), kind: EntityKind,
  sourceRevision: Revision, locale: Locale, revision: z.number().int().positive(),
  status: LocalizationStatus, fields: LocalizationFields,
}).strict();
export const EntityLocalizationWrite = z.object({
  sourceRevision: Revision,
  expectedTranslationRevision: z.number().int().positive().nullable(),
  status: LocalizationStatus,
  fields: LocalizationFields,
}).strict();
export type EntityLocalizationWrite = z.infer<typeof EntityLocalizationWrite>;
export const EntityLocalizationClear = EntityLocalizationWrite.pick({ sourceRevision: true })
  .extend({ expectedTranslationRevision: z.number().int().positive() }).strict();
export type EntityLocalizationClear = z.infer<typeof EntityLocalizationClear>;
export const EntitySourceLocaleWrite = z.object({ expectedSourceRevision: Revision, locale: Locale.nullable() }).strict();
export type EntitySourceLocaleWrite = z.infer<typeof EntitySourceLocaleWrite>;
export const EntityLocalizationAdminView = z.object({ source: EntityDisplaySource, translation: EntityLocalization.nullable() }).strict();
export type EntityLocalizationAdminView = z.infer<typeof EntityLocalizationAdminView>;
export const EntityLocalizationError = z.enum([
  "ROLE_INSUFFICIENT", "ENTITY_NOT_FOUND", "SOURCE_CHANGED", "TRANSLATION_CHANGED", "VALIDATION_FAILED",
]);

function adminOperations(kind: EntityKind) {
  const base = `/admin/${kind}s/:entityId/localizations/:locale`;
  return {
    get: { method: "GET", path: base, out: EntityLocalizationAdminView },
    put: { method: "PUT", path: base, in: EntityLocalizationWrite, out: EntityLocalizationAdminView },
    clear: { method: "DELETE", path: base, in: EntityLocalizationClear, out: EntityLocalizationAdminView },
    sourceLocale: { method: "PUT", path: `/admin/${kind}s/:entityId/localization-source`, in: EntitySourceLocaleWrite, out: EntityDisplaySource },
  } as const;
}
export const operations = { skill: adminOperations("skill"), agent: adminOperations("agent") } as const;

export const ResolvedDisplayField = z.object({
  value: Text, resolvedLocale: Locale.nullable(), fallback: z.boolean(),
}).strict();
const ResolvedFields = z.object(displayShape(ResolvedDisplayField)).strict();
export const LocalizedEntityDisplay = z.object({
  sourceRevision: Revision, sourceLocale: Locale.nullable(), requestedLocale: Locale,
  versionId: z.string().nullable().default(null),
  fields: ResolvedFields,
}).strict();
export type LocalizedEntityDisplay = z.infer<typeof LocalizedEntityDisplay>;

/** Projection only: never returns a replacement source entity or alters execution content. */
export function resolveEntityDisplay(
  rawSource: unknown, rawLocale: unknown, rawTranslation: unknown = null,
): LocalizedEntityDisplay {
  const source = EntityDisplaySource.parse(rawSource);
  const requestedLocale = Locale.parse(rawLocale);
  const parsed = EntityLocalization.safeParse(rawTranslation);
  const translation = parsed.success ? parsed.data : null;
  const eligible = translation !== null
    && translation.orgId === source.orgId && translation.entityId === source.entityId
    && translation.kind === source.kind && translation.sourceRevision === source.revision
    && translation.status === "reviewed" && translation.locale === requestedLocale
    && requestedLocale !== source.locale;
  const fields = {} as LocalizedEntityDisplay["fields"];
  for (const key of Object.keys(SourceFields.shape) as (keyof typeof source.fields)[]) {
    const value = eligible ? translation.fields[key] : null;
    const translated = typeof value === "string" && value.trim() !== "";
    fields[key] = {
      value: translated ? value : source.fields[key],
      resolvedLocale: translated ? requestedLocale : source.locale,
      fallback: !translated && requestedLocale !== source.locale,
    };
  }
  return { sourceRevision: source.revision, versionId: source.versionId, sourceLocale: source.locale, requestedLocale, fields };
}
