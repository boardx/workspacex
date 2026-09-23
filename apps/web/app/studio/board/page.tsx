import { AppShell } from '@/components/shell/app-shell';
import { WhiteboardLibrary } from '@/components/whiteboard/whiteboard-library';
export default function StudioBoardPage() {
  return <AppShell previewRole={null} hideTopBar fullscreen><WhiteboardLibrary /></AppShell>;
}
