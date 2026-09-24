import { setTimeout as wait } from 'node:timers/promises';
import { z } from 'zod';
import { whiteboardMiro as C } from '@repo/contracts';
import { MiroImportError as Fault, MiroRemoteUnauthorized, type MiroRemoteClient, type MiroTokenResult } from '../../application/whiteboard/miro-ports';

const API_ORIGIN = 'https://api.miro.com';
const AUTHORIZE_ORIGIN = 'https://miro.com';
const TokenResponse = z.object({
  access_token: z.string().min(1).max(16_384),
  refresh_token: z.string().min(1).max(16_384).nullable().optional(),
  expires_in: z.number().int().positive().max(31_536_000).optional(),
  scope: z.string().max(2_000).optional(),
}).passthrough();
const Board = z.object({ id:z.string().min(1).max(256), name:z.string().min(1).max(200), modifiedAt:z.string().datetime().optional() }).passthrough();
const BoardPage = z.object({ data:z.array(Board).max(C.MIRO_DIRECT_IMPORT.boardPageLimit), total:z.number().int().nonnegative().optional() }).passthrough();
const ItemPage = z.object({ data:z.array(z.record(z.unknown())).max(C.MIRO_DIRECT_IMPORT.itemPageLimit), cursor:z.string().min(1).max(2_000).nullable().optional() }).passthrough();

export interface MiroClientConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > C.MIRO_DIRECT_IMPORT.maxResponseBytes) throw new Fault('PAYLOAD_TOO_LARGE');
  if (!response.body) throw new Fault('REMOTE_SCHEMA_CHANGED');
  const reader=response.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
  try {
    while (true) {
      const part=await reader.read(); if (part.done) break;
      size+=part.value.byteLength; if (size>C.MIRO_DIRECT_IMPORT.maxResponseBytes) throw new Fault('PAYLOAD_TOO_LARGE');
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size); let offset=0; for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Fault('REMOTE_SCHEMA_CHANGED'); }
}

export class MiroApiClient implements MiroRemoteClient {
  constructor(
    private readonly config: MiroClientConfig,
    private readonly http: typeof fetch = fetch,
    private readonly sleep: (ms:number)=>Promise<unknown> = ms => wait(ms),
  private readonly timeoutMs = 10_000,
    private readonly now:()=>number = Date.now,
  ) {
    let callback: URL;
    try {
      callback = new URL(config.redirectUri);
    } catch {
      throw new Error('MIRO_OAUTH_CONFIG_INVALID');
    }
    if (
      !config.clientId
      || !config.clientSecret
      || callback.protocol !== 'https:'
      || callback.pathname !== '/studio/board/miro/callback'
      || callback.search
      || callback.hash
      || callback.username
      || callback.password
    ) {
      throw new Error('MIRO_OAUTH_CONFIG_INVALID');
    }
  }

  authorizationUrl(state: string): string {
    const url=new URL('/oauth/authorize',AUTHORIZE_ORIGIN);
    url.searchParams.set('response_type','code'); url.searchParams.set('client_id',this.config.clientId);
    url.searchParams.set('redirect_uri',this.config.redirectUri); url.searchParams.set('scope',C.MIRO_DIRECT_IMPORT.scope); url.searchParams.set('state',state);
    return url.toString();
  }

  async exchange(code: string): Promise<MiroTokenResult> {
    return this.token({ grant_type:'authorization_code', code, redirect_uri:this.config.redirectUri });
  }
  async refresh(refresh: string): Promise<MiroTokenResult> { return this.token({ grant_type:'refresh_token', refresh_token:refresh }); }
  async revoke(access: string): Promise<void> {
    try { await this.send(new URL('/v1/oauth/revoke',API_ORIGIN), { method:'POST', headers:{authorization:`Bearer ${access}`} }, false); } catch { /* local revoke is authoritative */ }
  }
  async boards(access: string, offset: number, limit: number) {
    const url=new URL('/v2/boards',API_ORIGIN); url.searchParams.set('offset',String(offset)); url.searchParams.set('limit',String(limit));
    const parsed=BoardPage.safeParse(await this.send(url,{headers:{authorization:`Bearer ${access}`}}));
    if (!parsed.success) throw new Fault('REMOTE_SCHEMA_CHANGED');
    return { items:parsed.data.data.map(value=>({id:value.id,name:value.name,modifiedAt:value.modifiedAt??null})), hasMore:parsed.data.total!==undefined ? offset+parsed.data.data.length<parsed.data.total : parsed.data.data.length===limit };
  }
  async board(access: string, boardId: string) {
    const parsed=Board.safeParse(await this.send(new URL(`/v2/boards/${encodeURIComponent(boardId)}`,API_ORIGIN),{headers:{authorization:`Bearer ${access}`}}));
    if (!parsed.success) throw new Fault('REMOTE_SCHEMA_CHANGED'); return parsed.data;
  }
  async items(access: string, boardId: string, cursor?: string) {
    const url=new URL(`/v2-experimental/boards/${encodeURIComponent(boardId)}/items`,API_ORIGIN);
    url.searchParams.set('limit',String(C.MIRO_DIRECT_IMPORT.itemPageLimit)); if (cursor) url.searchParams.set('cursor',cursor);
    const parsed=ItemPage.safeParse(await this.send(url,{headers:{authorization:`Bearer ${access}`}}));
    if (!parsed.success) throw new Fault('REMOTE_SCHEMA_CHANGED'); return parsed.data;
  }

  private async token(values: Record<string,string>): Promise<MiroTokenResult> {
    const body=new URLSearchParams({...values,client_id:this.config.clientId,client_secret:this.config.clientSecret});
    const parsed=TokenResponse.safeParse(await this.send(new URL('/v1/oauth/token',API_ORIGIN),{
      method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded'},
      body,
    }));
    if (!parsed.success) throw new Fault('REMOTE_SCHEMA_CHANGED');
    const scopes=(parsed.data.scope??'').split(/[ ,]+/).filter(Boolean);
    if (!scopes.includes(C.MIRO_DIRECT_IMPORT.scope)) throw new Fault('OAUTH_SCOPE_INSUFFICIENT');
    return { credential:{access:parsed.data.access_token,refresh:parsed.data.refresh_token??null}, scopes,
      expiresAt:parsed.data.expires_in ? new Date(Date.now()+parsed.data.expires_in*1000).toISOString() : null };
  }

  private async send(url: URL, init: RequestInit, json = true): Promise<unknown> {
    if (url.origin!==API_ORIGIN) throw new Fault('INVALID_REQUEST');
    for (let attempt=0;attempt<3;attempt++) {
      const abort=new AbortController(), timer=setTimeout(()=>abort.abort(),this.timeoutMs);
      let response:Response;
      try { response=await this.http(url,{...init,signal:abort.signal,redirect:'error'}); }
      catch (error) { if ((error as {name?:string}).name==='AbortError') throw new Fault('REMOTE_TIMEOUT'); throw new Fault('REMOTE_UNAVAILABLE'); }
      finally { clearTimeout(timer); }
      if (response.status===429) {
        await response.body?.cancel();
        if (attempt===2) throw new Fault('REMOTE_RATE_LIMITED');
        const header=response.headers.get('retry-after'), seconds=header===null?NaN:Number(header), date=header===null?NaN:Date.parse(header);
        const delay=Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-this.now():250*2**attempt;
        await this.sleep(Math.min(10_000,Math.max(0,delay))); continue;
      }
      if (response.status===401) { await response.body?.cancel(); throw new MiroRemoteUnauthorized(); }
      if (!response.ok) { await response.body?.cancel(); throw new Fault('REMOTE_UNAVAILABLE'); }
      if (!json) { await response.body?.cancel(); return undefined; }
      return readBoundedJson(response);
    }
    throw new Fault('REMOTE_RATE_LIMITED');
  }
}

export function miroApiClientFromEnv(): MiroApiClient {
  return new MiroApiClient({ clientId:process.env.MIRO_CLIENT_ID??'', clientSecret:process.env.MIRO_CLIENT_SECRET??'', redirectUri:process.env.MIRO_OAUTH_REDIRECT_URI??'' });
}

/** Keeps unrelated API boot paths usable; the first Miro operation still fails closed on missing config. */
export class EnvironmentMiroApiClient implements MiroRemoteClient {
  private client() { return miroApiClientFromEnv(); }
  authorizationUrl(state:string){return this.client().authorizationUrl(state);}
  exchange(code:string){return this.client().exchange(code);}
  refresh(refresh:string){return this.client().refresh(refresh);}
  revoke(access:string){return this.client().revoke(access);}
  boards(access:string,offset:number,limit:number){return this.client().boards(access,offset,limit);}
  board(access:string,boardId:string){return this.client().board(access,boardId);}
  items(access:string,boardId:string,cursor?:string){return this.client().items(access,boardId,cursor);}
}
