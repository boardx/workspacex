/**
 * F39 -- PII detection over extracted text, O-39's minimum five-class set (uc-22-2 R3 step 11
 * / R7 / R9): 邮箱 / 手机号 / 身份证号 / 银行卡号 / 详细住址.
 *
 * ⚠ Same discipline `malware-scan.ts` states for itself: this is a SIGNATURE check, not a
 * production-grade PII/NLP engine. No such engine exists anywhere in this codebase yet. What
 * `resolveReviewPending`'s gate actually needs proven is the STRUCTURAL behaviour -- a file
 * whose extracted content contains a recognisable instance of one of the five classes is
 * routed to `REVIEW_PENDING`, never silently indexed -- and a deterministic regex classifier
 * is the standard, reproducible way to assert exactly that in a test fixture. Wiring a real
 * PII-detection service in behind this same shape later does not change any caller: the
 * review gate only ever sees `readonly PiiClass[]`.
 *
 * `address`（详细住址）has no reliable regex the way a phone or an id number does -- treated
 * here as a coarse heuristic (a street/administrative-unit keyword immediately followed by a
 * digit run, e.g. "路11号" / "省…市…区…号"), documented as a heuristic rather than a claim of
 * completeness. `[待定 T-9]` covers only the PARSE-QUALITY threshold, not this detector's
 * precision -- the five CLASSES themselves are the structural fact O-39 already settled.
 */

export type PiiClass = "email" | "phone" | "id-card" | "bank-card" | "address";

export const PII_CLASS_LABEL: Readonly<Record<PiiClass, string>> = {
  email: "邮箱",
  phone: "手机号",
  "id-card": "身份证号",
  "bank-card": "银行卡号",
  address: "详细住址",
};

/** 邮箱: standard local@domain shape. */
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/** 中国大陆手机号: 1[3-9]xxxxxxxxx, 11 digits, not part of a longer digit run. */
const PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/;

/** 身份证号: 18 digits, last may be X/x (GB 11643 checksum position). */
const ID_CARD_RE = /(?<!\d)\d{17}[\dXx](?!\d)/;

/** 银行卡号: 13-19 digit PAN-shaped run (ISO/IEC 7812), not overlapping a longer digit run. */
const BANK_CARD_RE = /(?<!\d)\d{13,19}(?!\d)/;

/**
 * 详细住址 heuristic: an administrative/street-suffix keyword immediately followed by a
 * number token (门牌号) -- e.g. "中关村大街1号" / "建国路88号" / "望京西园3区". Coarse on
 * purpose (see module header); a false negative here means "not flagged", which is the
 * SAFE direction for a structural stand-in (a real detector can only widen recall, never
 * narrow the classes O-39 already fixed).
 */
const ADDRESS_RE = /(省|市|区|县|路|街|巷|弄|号|栋|单元|室)\d+(号|栋|单元|室|楼)?/;

function isBankCardNotIdCard(hit: string): boolean {
  // A run that ALSO matches ID_CARD_RE (18 digits, last optionally X) is reported as
  // `id-card`, not double-counted as `bank-card` -- the two regexes' domains legitimately
  // overlap in length (13-19 digits) and a caller wants "which ONE class", not both.
  return !/^\d{17}[\dXx]$/.test(hit);
}

/** Every O-39 class recognised in `text`, each at most once, in the fixed declaration order. */
export function detectPii(text: string): readonly PiiClass[] {
  const hits: PiiClass[] = [];
  if (EMAIL_RE.test(text)) hits.push("email");
  if (PHONE_RE.test(text)) hits.push("phone");
  if (ID_CARD_RE.test(text)) hits.push("id-card");
  const bankMatch = BANK_CARD_RE.exec(text);
  if (bankMatch !== null && isBankCardNotIdCard(bankMatch[0])) hits.push("bank-card");
  if (ADDRESS_RE.test(text)) hits.push("address");
  return hits;
}

export function hasPii(text: string): boolean {
  return detectPii(text).length > 0;
}
