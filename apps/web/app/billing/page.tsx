"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PERSONAL_BILLING_ENTRY } from "@/lib/navigation";
import { BillingOverview } from "@/components/billing/billing-overview";
import { useSession } from "@/components/session/session-provider";
import { AppShell } from "@/components/shell/app-shell";

function BillingContent() {
  const router = useRouter();
  const search = useSearchParams();
  const consumed = React.useCallback(() => router.replace(PERSONAL_BILLING_ENTRY.href, { scroll: false }), [router]);
  const { session } = useSession();
  return <AppShell previewRole={null}>
    {session && <BillingOverview key={`${session.currentOrgId}:${session.userId}:${session.sessionToken}`} userId={session.userId} sessionToken={session.sessionToken} openOnReady={search.get("purchase") === "1"} onPurchaseOpened={consumed} />}
  </AppShell>;
}

export default function BillingPage() {
  return <React.Suspense fallback={<p role="status">正在查询账户…</p>}><BillingContent /></React.Suspense>;
}
