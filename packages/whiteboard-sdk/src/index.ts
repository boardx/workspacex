import { operations, PublicWhiteboardCommands, PublicWhiteboardCommandResult, PublicWhiteboardDocument } from '@repo/contracts/whiteboard-public';

export class WhiteboardApiError extends Error {
  constructor(readonly status: number) { super(`Whiteboard API returned HTTP ${status}`); this.name = 'WhiteboardApiError'; }
}
export interface WhiteboardClientOptions {
  fetch?: typeof globalThis.fetch;
  getToken?: () => string | null | Promise<string | null>;
}
export class WhiteboardAuthenticationError extends Error {
  constructor() { super('A current WorkspaceX session token is required'); this.name = 'WhiteboardAuthenticationError'; }
}
/** Resolves the host's bearer session for each request; never persists or logs tokens. */
export class WhiteboardClient {
  private readonly baseUrl: string;
  private readonly request: typeof globalThis.fetch;
  private readonly getToken?: WhiteboardClientOptions['getToken'];
  constructor(baseUrl: string, options: WhiteboardClientOptions | typeof globalThis.fetch = {}) {
    const config = typeof options === 'function' ? { fetch: options } : options;
    this.request = config.fetch ?? globalThis.fetch;
    this.getToken = config.getToken;
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Expected an HTTP API base URL without embedded credentials');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }
  private async headers(json = false): Promise<Record<string, string>> {
    const headers: Record<string, string> = json ? { 'content-type': 'application/json' } : {};
    if (this.getToken) {
      let token: string | null;
      try { token = await this.getToken(); } catch { throw new WhiteboardAuthenticationError(); }
      if (typeof token !== 'string' || !/^[A-Za-z0-9._~+/-]+=*$/.test(token)) throw new WhiteboardAuthenticationError();
      headers.authorization = `Bearer ${token}`;
    }
    return headers;
  }
  async document(boardId: string, signal?: AbortSignal): Promise<PublicWhiteboardDocument> {
    const input = operations.readDocument.in.parse({ boardId });
    const response = await this.request(`${this.baseUrl}${operations.readDocument.path.replace(':boardId', encodeURIComponent(input.boardId))}`, { method: operations.readDocument.method, credentials: 'omit', headers: await this.headers(), signal });
    if (!response.ok) throw new WhiteboardApiError(response.status);
    return PublicWhiteboardDocument.parse(await response.json());
  }
  async commands(boardId: string, commands: PublicWhiteboardCommands, signal?: AbortSignal): Promise<PublicWhiteboardCommandResult> {
    const id = operations.readDocument.in.parse({ boardId }).boardId, input = operations.writeCommands.in.parse(commands);
    const response = await this.request(`${this.baseUrl}${operations.writeCommands.path.replace(':boardId', encodeURIComponent(id))}`, { method: operations.writeCommands.method, credentials: 'omit', headers: await this.headers(true), body: JSON.stringify(input), signal });
    if (!response.ok) throw new WhiteboardApiError(response.status);
    return PublicWhiteboardCommandResult.parse(await response.json());
  }
}
export { PublicWhiteboardCommands, PublicWhiteboardCommandResult, PublicWhiteboardDocument } from '@repo/contracts/whiteboard-public';
