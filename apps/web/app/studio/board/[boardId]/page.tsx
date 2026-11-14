import { Suspense } from 'react';
import { AidtBoardReturn } from '@/features/aidt/entry/board-return';
import { AppShell } from '@/components/shell/app-shell';
import { LiveBoard } from '@/components/whiteboard/live-board';
export default function BoardDocumentPage({ params }: { params: { boardId: string } }) {
  return <AppShell previewRole={null} hideTopBar fullscreen><Suspense fallback={null}><AidtBoardReturn /></Suspense><LiveBoard boardId={params.boardId}/></AppShell>;
}
