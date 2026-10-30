/** Financial accounting failures must stop dispatch rather than silently provide free usage. */
export class CreditConsumptionError extends Error {
  readonly rechargePath: string;
  constructor(readonly code: "credit_required" | "credit_accounting_unavailable", readonly ownerType: "user" | "team", readonly ownerId: string, message: string = code) {
    super(message);
    this.name = "CreditConsumptionError";
    this.rechargePath = ownerType === "user" ? "/billing?purchase=1" : `/billing?ownerType=team&ownerId=${encodeURIComponent(ownerId)}&purchase=1`;
  }
}
/** Exact integer hundredths: never use binary floating arithmetic to calculate a debit. */
export function tokenCreditHundredths(tokens: number): bigint {
  if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error("invalid_credit_token_quantity");
  return (BigInt(tokens) + 9n) / 10n;
}
export function creditDecimal(hundredths: bigint): string {
  const sign = hundredths < 0n ? "-" : "", magnitude = hundredths < 0n ? -hundredths : hundredths;
  return `${sign}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, "0")}`;
}

export function creditHundredths(value: string): bigint {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("invalid_credit_decimal");
  const negative = value.startsWith("-"), [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const magnitude = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -magnitude : magnitude;
}

/** Canonical immutable accounting identity, including bigint native quantities. */
export function creditFacts(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() :
    item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

/** Admission and settlement errors retain their typed HTTP/stream guidance through model adapters. */
export function rethrowCreditConsumption(error:unknown):void {if(error instanceof CreditConsumptionError)throw error;}
