import type { EntityKind, LocalizedEntityDisplay } from "@repo/contracts/entity-localization";
import { Locale } from "@repo/contracts/locale";
import { EntityLocalizationError, type EntityLocalizationRepository } from "./entity-localization";

export function matchesDisplayQuery(display: LocalizedEntityDisplay | undefined, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return needle === "" || (display !== undefined && Object.values(display.fields)
    .some(field => typeof field.value === "string" && field.value.toLowerCase().includes(needle)));
}

/** Call only after the existing read use case has disclosed these rows. No independent read authority. */
export async function localizeAuthorizedItems<T extends object>(rows: readonly T[], input: {
  orgId: string; kind: EntityKind; locale?: unknown; idOf: (row: T) => string;
  versionOf?: (row: T) => string | null | undefined;
  repository?: EntityLocalizationRepository;
}): Promise<readonly (T & { display?: LocalizedEntityDisplay })[]> {
  if (input.locale === undefined) return rows;
  const locale = Locale.safeParse(input.locale);
  if (!locale.success) throw new EntityLocalizationError("VALIDATION_FAILED");
  if (rows.length === 0) return rows;
  if (!input.repository) throw new Error("entity localization repository not configured");
  const displays = await input.repository.displays(input.orgId, input.kind, rows.map(input.idOf), locale.data);
  return rows.map(row => {
    const display = displays.get(input.idOf(row));
    // A concurrent publish must not attach current-version copy to a historical card.
    const expectedVersion = input.versionOf?.(row);
    if (!display || (expectedVersion !== undefined && display.versionId !== expectedVersion)) return row;
    return { ...row, display };
  });
}
