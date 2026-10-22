"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PERSONAL_BILLING_ENTRY } from "@/lib/navigation";
import { TeamBillingOverview } from "@/components/billing/team-billing-overview";
import { BillingOverview } from "@/components/billing/billing-overview";
import { useSession } from "@/components/session/session-provider";
import { AppShell } from "@/components/shell/app-shell";

function BillingContent() {
  const router = useRouter();
  const search = useSearchParams();
  const consumed = React.useCallback(() => router.replace(PERSONAL_BILLING_ENTRY.href, { scroll: false }), [router]);
  const { session } = useSession();
  const teamRequested = search.get("ownerType") === "team";
  const teamId = teamRequested ? search.get("ownerId") : null;
  return <AppShell previewRole={null}>
    {session && teamRequested && !teamId ? <p role="alert">缺少组织信息，请联系管理员打开组织充值入口。</p> : session && teamId ? <TeamBillingOverview key={`${session.sessionToken}:${teamId}`} ownerId={teamId} sessionToken={session.sessionToken} openOnReady={search.get("purchase") === "1"}/> : session && <BillingOverview key={`${session.currentOrgId}:${session.userId}:${session.sessionToken}`} userId={session.userId} sessionToken={session.sessionToken} openOnReady={search.get("purchase") === "1"} onPurchaseOpened={consumed} />}
  </AppShell>;
}

export default function BillingPage() {
  return <React.Suspense fallback={<p role="status">正在查询账户…</p>}><BillingContent /></React.Suspense>;
}
