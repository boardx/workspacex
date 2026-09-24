export function whiteboardRoomSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.WHITEBOARD_ROOM_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (env.NODE_ENV === 'production') throw new Error('WHITEBOARD_ROOM_SECRET is required in production');
  return 'workspacex-development-room-secret-change-me';
}
