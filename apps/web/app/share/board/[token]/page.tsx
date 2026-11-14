import type { Metadata } from 'next';
import { PublicBoardShareScreen } from '@/components/whiteboard/public-board-share-screen';

export const metadata: Metadata = {
  title: '共享白板',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function SharedBoardPage({ params }: { params: Promise<{ token: string }> }) {
  return <PublicBoardShareScreen token={(await params).token} />;
}
