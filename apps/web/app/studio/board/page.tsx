import { AppShell } from '@/components/shell/app-shell';
import { WhiteboardScreen } from '@/components/whiteboard/whiteboard-screen';
import { resolvePreviewState } from '@/lib/ui-state';
export default function StudioBoardPage({ searchParams }: { searchParams: { state?: string } }) {
  return <AppShell previewRole={null} hideTopBar><WhiteboardScreen state={resolvePreviewState(searchParams.state)} /></AppShell>;
}
