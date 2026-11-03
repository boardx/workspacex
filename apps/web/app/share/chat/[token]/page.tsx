import { readLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/messages";
import type { Metadata } from "next";
import { PublicChatShareScreen } from "@/components/chat/public-chat-share-screen";
export function generateMetadata(): Metadata { return {
  title: translate(readLocale(), "chatShare.metadata"),
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
}; }
export default async function SharedChatPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicChatShareScreen token={token} />;
}
