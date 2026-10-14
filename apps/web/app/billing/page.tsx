"use client";
import { BillingOverview } from "@/components/billing/billing-overview";
import { useSession } from "@/components/session/session-provider";
import { AppShell } from "@/components/shell/app-shell";

export default function BillingPage() {
  const { session } = useSession();
  return <AppShell previewRole={null}>
    {session && <BillingOverview key={`${session.currentOrgId}:${session.userId}:${session.sessionToken}`} userId={session.userId} sessionToken={session.sessionToken} />}
  </AppShell>;
}
