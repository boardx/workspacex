import type { Metadata } from "next";
import { PublicChatShareScreen } from "@/components/chat/public-chat-share-screen";
export const metadata: Metadata = {
  title: "对话分享 · WorkspaceX",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};
export default async function SharedChatPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicChatShareScreen token={token} />;
}
