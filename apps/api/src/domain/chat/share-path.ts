/** Share tokens are bearer secrets and must not enter request diagnostics. */
export function redactChatSharePath(path: string): string {
  return path.replace(/(\/chat\/shares\/)[^/?#]+/g, "$1:token");
}
