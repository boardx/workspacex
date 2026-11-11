"use client";

import { useOptionalSession } from "@/components/session/session-provider";
import { useI18n } from "@/lib/i18n/provider";
import { MemberCreditQuotaPanel } from "./member-credit-quota-panel";

export function MemberQuotaTab() {
  const orgId = useOptionalSession()?.session?.currentOrgId;
  const { t } = useI18n();
  if (!orgId) {
    return <p className="text-12 text-muted-foreground">{t("adminCommon.headerNoOrg")}</p>;
  }
  return <MemberCreditQuotaPanel key={orgId} orgId={orgId} />;
}
