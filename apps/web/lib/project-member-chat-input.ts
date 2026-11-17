/** Safari and some IMEs report the confirmation Enter as non-composing with keyCode 229.
 * Keep this guard shared by the live human channel and its UI preview.
 */
export function isMemberChatComposing(event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean {
  return event.isComposing || event.keyCode === 229;
}
