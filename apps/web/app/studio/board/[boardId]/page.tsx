import { AppShell } from '@/components/shell/app-shell';
import { LiveBoard } from '@/components/whiteboard/live-board';
export default function BoardDocumentPage({ params }: { params: { boardId: string } }) {
  return <AppShell previewRole={null} hideTopBar fullscreen><div data-live-board-page className="h-full min-w-0 overflow-x-hidden overflow-y-auto sm:overflow-hidden"><LiveBoard boardId={params.boardId}/></div></AppShell>;
}
