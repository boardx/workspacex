import { AppShell } from "@/components/shell/app-shell";
import { InboxScreen } from "@/components/inbox/inbox-screen";

export default function InboxPage({ searchParams }: { searchParams: { message?: string } }) {
  return <AppShell previewRole={null}><InboxScreen key={searchParams.message ?? ""} initialMessage={searchParams.message} /></AppShell>;
}
