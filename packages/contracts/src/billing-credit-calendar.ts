/** Every boundary derives from the original UTC purchase anchor, never a clamped prior month. */
export function creditMonthBoundary(anchor: Date, offset: number): Date {
  if (!Number.isFinite(anchor.getTime()) || !Number.isSafeInteger(offset) || offset < 0) throw new Error("credit_anchor_invalid");
  const boundary = new Date(anchor);
  boundary.setUTCDate(1);
  boundary.setUTCMonth(anchor.getUTCMonth() + offset);
  if (!Number.isFinite(boundary.getTime())) throw new Error("credit_anchor_invalid");
  const last = new Date(boundary);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  if (!Number.isFinite(last.getTime())) throw new Error("credit_anchor_invalid");
  boundary.setUTCDate(Math.min(anchor.getUTCDate(), last.getUTCDate()));
  return boundary;
}

export function paidCreditMonthCount(cycle: "month" | "year"): number {
  if(cycle === "month") return 1;
  if(cycle === "year") return 12;
  throw new Error("credit_term_invalid");
}

export type PaidCreditWindow = { index: number; start: Date; end: Date };
/** Includes elapsed windows for auditable late recovery; accounting expires their unused credit. */
export function paidCreditWindows(anchor: Date, cycle: "month" | "year", at: Date, monthOffset = 0): PaidCreditWindow[] {
  if (!Number.isFinite(anchor.getTime()) || !Number.isFinite(at.getTime()) || !Number.isSafeInteger(monthOffset) || monthOffset < 0) throw new Error("credit_term_invalid");
  const count=paidCreditMonthCount(cycle);
  const result: PaidCreditWindow[] = [];
  for (let index = 0; index < count; index++) {
    const start = creditMonthBoundary(anchor, monthOffset + index);
    if (start > at) break;
    result.push({ index, start, end: creditMonthBoundary(anchor, monthOffset + index + 1) });
  }
  return result;
}

export type CreditMonthWindow = { offset: number; start: Date; end: Date };
/** Find the unique left-closed/right-open month containing the actual payment instant. */
export function creditMonthWindowAt(anchor: Date, at: Date): CreditMonthWindow | null {
  if (!Number.isFinite(anchor.getTime()) || !Number.isFinite(at.getTime())) throw new Error("credit_term_invalid");
  if (at < anchor) return null;
  let offset = (at.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + at.getUTCMonth() - anchor.getUTCMonth();
  let start = creditMonthBoundary(anchor, offset);
  if (start > at) {
    offset--;
    if (offset < 0) return null;
    start = creditMonthBoundary(anchor, offset);
  }
  return { offset, start, end: creditMonthBoundary(anchor, offset + 1) };
}
