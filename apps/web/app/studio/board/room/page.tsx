import { AppShell } from '@/components/shell/app-shell';
import { RoomDisplay } from '@/components/whiteboard/room-display';
export default function WhiteboardRoomPage(){return <AppShell previewRole={null} hideTopBar fullscreen><RoomDisplay/></AppShell>;}
