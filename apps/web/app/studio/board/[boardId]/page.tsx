import { AppShell } from '@/components/shell/app-shell';
import { LiveBoard } from '@/components/whiteboard/live-board';
export default function BoardDocumentPage({ params }: { params: { boardId: string } }) {
  return <AppShell previewRole={null} hideTopBar fullscreen><LiveBoard boardId={params.boardId}/></AppShell>;
}
