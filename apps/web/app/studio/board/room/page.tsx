import { RoomDisplay } from '@/components/whiteboard/room-display';

/** Public, credential-scoped meeting-room surface. Authentication is the one-time
 * pairing grant handled by RoomDisplay, so this route must not enter AppShell's
 * user-session redirect. */
export default function WhiteboardRoomPage() {
  return <div data-testid="shell-main" className="h-dvh w-screen overflow-hidden"><RoomDisplay /></div>;
}
