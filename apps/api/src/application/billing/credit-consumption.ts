import type {CreditRequiredReason} from "@repo/contracts/billing-consumption";
/** Financial accounting failures must stop dispatch rather than silently provide free usage. */
export class CreditConsumptionError extends Error {
  readonly rechargePath: string;
  constructor(readonly code: "credit_required" | "credit_accounting_unavailable", readonly ownerType: "user" | "team", readonly ownerId: string, message: string = code, readonly reason?: CreditRequiredReason) {
    super(message);
    this.name = "CreditConsumptionError";
    this.rechargePath = ownerType === "user" ? "/billing?purchase=1" : `/billing?ownerType=team&ownerId=${encodeURIComponent(ownerId)}&purchase=1`;
  }
}
/** Exact integer hundredths: never use binary floating arithmetic to calculate a debit. */
export const DEFAULT_CREDIT_RATE_BPS = 10_000;

export function creditRateBps(value: unknown = DEFAULT_CREDIT_RATE_BPS): number {
  if (typeof value === "string" && /^[1-9]\d{0,6}$/.test(value)) value = Number(value);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    throw new Error("invalid_credit_rate_bps");
  }
  return value;
}

export function ratedCreditHundredths(numerator: bigint, denominator: bigint, bps: number): bigint {
  const divisor = denominator * BigInt(DEFAULT_CREDIT_RATE_BPS);
  return (numerator * BigInt(bps) + divisor - 1n) / divisor;
}

export function tokenCreditHundredths(tokens: number, bps = DEFAULT_CREDIT_RATE_BPS): bigint {
  if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error("invalid_credit_token_quantity");
  return ratedCreditHundredths(BigInt(tokens), 10n, bps);
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
