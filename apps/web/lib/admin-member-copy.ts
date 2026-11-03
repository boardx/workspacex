import { ApiError } from "./api-client";
import type { Locale } from "./i18n/locale";
import type { MessageKey, MessageParams } from "./i18n/messages";

export type MemberTranslator = (key: MessageKey, params?: MessageParams) => string;
export type MemberFeedback = (t: MemberTranslator, locale: Locale) => string;

export function formatMemberTokens(n: number, locale: Locale): string {
  if (locale === "en") return new Intl.NumberFormat("en").format(n);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(0)} 万`;
  return n.toLocaleString();
}

export function memberFailure(error: unknown, t: MemberTranslator): string {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return t("common.http.auth");
    if (error.status === 404) return t("common.http.notFound");
    if (error.status === 429) return t("common.http.rateLimit");
    if (error.status >= 500) return t("common.http.server");
    return t("common.http.failure");
  }
  if (error instanceof TypeError) return t("failures.network");
  return t("failures.unknown");
}

const roleKeys = {
  admin: "role.admin", lead: "role.lead", consultant: "role.consultant",
  compliance: "role.compliance", facilitator: "role.facilitator",
  groupLead: "role.groupLead", member: "role.member", observer: "role.observer",
} as const satisfies Record<string, MessageKey>;
export function memberRoleLabel(role: string, t: MemberTranslator): string {
  return Object.prototype.hasOwnProperty.call(roleKeys, role)
    ? t(roleKeys[role as keyof typeof roleKeys]) : role;
}
