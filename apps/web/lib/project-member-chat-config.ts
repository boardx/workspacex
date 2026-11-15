/** Independent build-time opt-in; ordinary Chat and projects keep their defaults. */
export function parseProjectMemberChatEnabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}
export function isProjectMemberChatEnabled(): boolean {
  return parseProjectMemberChatEnabled(process.env.NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT);
}
