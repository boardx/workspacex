import { z } from "zod";
import { Locale } from "./locale";
import { LocalizationFields } from "./entity-localization";

/** Portable copy has no tenant IDs or database revision coordinates. The verified
 * pack binds it to unchanged source/execution content; import rebinds to its snapshot. */
export const PackLocalization = z.object({
  sourceLocale: Locale.nullable(),
  translations: z.record(Locale, LocalizationFields),
}).strict();
export type PackLocalization = z.infer<typeof PackLocalization>;
