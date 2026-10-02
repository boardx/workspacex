/** Match only this board's upload through the API or the configured web proxy. */
export function isBoardFileUploadResponse(method: string, responseUrl: string, boardId: string, apiUrl: string, webUrl: string): boolean {
  if (method !== 'POST') return false;
  try {
    const response = new URL(responseUrl), api = new URL(apiUrl), web = new URL(webUrl);
    if (response.username || response.password || response.search || response.hash) return false;
    const path = `/whiteboards/${boardId}/files`;
    return (response.origin === api.origin && response.pathname === path)
      || (response.origin === web.origin && response.pathname === `/__fullstack_api${path}`);
  } catch { return false; }
}
