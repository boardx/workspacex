import { UnprocessableEntityException } from "@nestjs/common";
import { Locale } from "@repo/contracts/locale";

export function parseDisplayLocale(value: unknown): Locale | undefined {
  if (value === undefined) return undefined;
  const parsed = Locale.safeParse(value);
  if (!parsed.success) throw new UnprocessableEntityException({ reasonCode: "VALIDATION_FAILED" });
  return parsed.data;
}
