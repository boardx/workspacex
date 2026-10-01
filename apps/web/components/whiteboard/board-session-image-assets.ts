import { WhiteboardAssetMetadata, WHITEBOARD_ASSET_LIMITS } from '@repo/contracts/whiteboard-asset';
import { apiUrl,getStoredSessionToken } from '@/lib/api-client';
import { readBoundedBytes } from './board-content-adapter';
import type { CanonicalContentObject } from "@repo/whiteboard-core";

export type BoardImageMime = Extract<CanonicalContentObject, { type: "image" }>["mimeType"];

export interface BoardSessionImageAsset {
  assetId: string;
  objectUrl: string;
  blob: Blob;
  mimeType: BoardImageMime;
  byteSize: number;
  contentDigest: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
}

const assets = new Map<string, BoardSessionImageAsset>();
const MAX_SESSION_IMAGE_BYTES = 200 * 1024 * 1024;
let retainedBytes = 0;

/** Bytes live only in this browser session. The canonical document stores the opaque handle and verified metadata. */
export function registerBoardSessionImageAsset(input: Omit<BoardSessionImageAsset, "assetId" | "objectUrl">): BoardSessionImageAsset {
  if (input.byteSize !== input.blob.size) throw new Error("SESSION_ASSET_SIZE_MISMATCH");
  if (retainedBytes + input.byteSize > MAX_SESSION_IMAGE_BYTES) throw new Error("SESSION_ASSET_CAPACITY_EXCEEDED");
  const assetId = `local-session-${crypto.randomUUID()}`;
  const asset = { ...input, assetId, objectUrl: URL.createObjectURL(input.blob) };
  assets.set(assetId, asset);
  retainedBytes += input.byteSize;
  return asset;
}

export function getBoardSessionImageAsset(assetId: string | null | undefined): BoardSessionImageAsset | undefined {
  return assetId ? assets.get(assetId) : undefined;
}

export function revokeBoardSessionImageAsset(assetId: string): void {
  const asset = assets.get(assetId);
  if (!asset) return;
  URL.revokeObjectURL(asset.objectUrl);
  assets.delete(assetId);
  retainedBytes = Math.max(0, retainedBytes - asset.byteSize);
}

/** A mounted board owns its URLs. Handles never share a cache across boards/users. */
export class BoardDurableImageSession {
  private readonly cache = new Map<string, BoardSessionImageAsset>();
  private readonly pending = new Map<string, Promise<BoardSessionImageAsset>>();
  private readonly controller = new AbortController();
  private bytes = 0;
  private closed = false;
  constructor(private readonly boardId: string, private readonly changed: () => void, private readonly fetcher: typeof fetch = (...args) => globalThis.fetch(...args)) {}
  get(assetId: string | null | undefined) { return assetId ? this.cache.get(assetId) : undefined; }
  private async request(path: string, init: RequestInit = {}) {
    if(this.closed) throw new Error('IMAGE_SESSION_CLOSED');
    const token=getStoredSessionToken();
    if(!token) throw new Error('IMAGE_ACCESS_DENIED');
    const signal=init.signal ? AbortSignal.any([init.signal,this.controller.signal]) : this.controller.signal;
    const response=await this.fetcher(apiUrl(`/whiteboards/${encodeURIComponent(this.boardId)}/assets${path}`),{
      ...init,signal,credentials:'include',cache:'no-store',redirect:'error',headers:{...init.headers,Authorization:`Bearer ${token}`},
    });
    if(!response.ok){
      if([401,403,404].includes(response.status))this.dispose();
      throw new Error([401,403,404].includes(response.status)?'IMAGE_ACCESS_DENIED':'IMAGE_ASSET_UNAVAILABLE');
    }
    return response;
  }
  async upload(blob: Blob, fileName: string, signal?: AbortSignal) {
    const body=new FormData();body.append('file',blob,fileName);
    const metadata=WhiteboardAssetMetadata.parse(await (await this.request('',{method:'POST',body,signal})).json());
    await this.ensure(metadata,signal);
    return metadata;
  }
  async ensure(input: WhiteboardAssetMetadata, signal?: AbortSignal): Promise<BoardSessionImageAsset> {
    if(this.closed)throw new Error('IMAGE_SESSION_CLOSED');
    const metadata=WhiteboardAssetMetadata.parse(input),cached=this.cache.get(metadata.assetId);
    if(cached){if(cached.contentDigest!==metadata.contentDigest||cached.byteSize!==metadata.byteSize)throw new Error('IMAGE_ASSET_INTEGRITY');return cached;}
    const pending=this.pending.get(metadata.assetId);if(pending)return pending;
    const promise=(async()=>{
      const response=await this.request(`/${encodeURIComponent(metadata.assetId)}/content`,{signal});
      const bytes=await readBoundedBytes(response,WHITEBOARD_ASSET_LIMITS.bytes);
      const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes));
      const contentDigest=`sha256:${Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('')}`;
      if(bytes.byteLength!==metadata.byteSize||contentDigest!==metadata.contentDigest||response.headers.get('content-type')?.split(';')[0]!==metadata.mimeType)throw new Error('IMAGE_ASSET_INTEGRITY');
      if(this.closed||signal?.aborted)throw new Error('IMAGE_SESSION_CLOSED');
      if(this.bytes+bytes.byteLength>MAX_SESSION_IMAGE_BYTES)throw new Error('SESSION_ASSET_CAPACITY_EXCEEDED');
      const blob=new Blob([new Uint8Array(bytes)],{type:metadata.mimeType});
      const asset={...metadata,blob,objectUrl:URL.createObjectURL(blob)};
      this.bytes+=bytes.byteLength;this.cache.set(metadata.assetId,asset);this.changed();return asset;
    })();
    this.pending.set(metadata.assetId,promise);
    try{return await promise;}finally{this.pending.delete(metadata.assetId);}
  }
  dispose(){
    this.closed=true;this.controller.abort();
    for(const asset of this.cache.values())URL.revokeObjectURL(asset.objectUrl);
    this.cache.clear();this.bytes=0;this.changed();
  }
}

export function durableBoardImageMetadata(content: CanonicalContentObject | null | undefined): WhiteboardAssetMetadata | null {
  if(content?.type!=='image'||content.status!=='ready'||content.persistence==='local-session')return null;
  const {assetId,mimeType,magicMimeType,byteSize,contentDigest,intrinsicWidth,intrinsicHeight}=content;
  const result=WhiteboardAssetMetadata.safeParse({assetId,mimeType,magicMimeType,byteSize,contentDigest,intrinsicWidth,intrinsicHeight,persistence:'durable'});
  return result.success?result.data:null;
}
