import { WhiteboardFileMetadata, WHITEBOARD_FILE_LIMITS } from '@repo/contracts/whiteboard-file';
import type { CanonicalContentObject } from '@repo/whiteboard-core';
import { apiUrl, getStoredSessionToken } from '@/lib/api-client';
import { readBoundedBytes } from './board-content-adapter';

type FileTile = Extract<CanonicalContentObject, { type: 'tile' }>;
async function request(boardId: string, path: string, init: RequestInit = {}) {
  const token = getStoredSessionToken();
  if (!token) throw new Error('FILE_ACCESS_DENIED');
  const response = await fetch(apiUrl(`/whiteboards/${encodeURIComponent(boardId)}/files${path}`), {
    ...init, credentials: 'include', cache: 'no-store', redirect: 'error', headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error([401, 403, 404].includes(response.status) ? 'FILE_ACCESS_DENIED' : response.status === 413 ? 'FILE_TOO_LARGE' : 'FILE_ASSET_UNAVAILABLE');
  return response;
}
export function boardFileTile(metadata: WhiteboardFileMetadata): FileTile {
  const size = metadata.byteSize < 1024 ? `${metadata.byteSize} B` : metadata.byteSize < 1024 * 1024 ? `${(metadata.byteSize / 1024).toFixed(1)} KB` : `${(metadata.byteSize / (1024 * 1024)).toFixed(1)} MB`;
  return { version: 1, type: 'tile', tileType: 'file', title: metadata.fileName, description: `${metadata.mimeType} · ${size}`, icon: 'file', coverAssetId: null,
    fields: Object.entries(metadata).map(([key, value]) => ({ key, label: '', value: String(value) })), tags: [], link: null, status: 'ready', actions: ['download'] };
}
export function boardFileMetadata(content: CanonicalContentObject | null | undefined): WhiteboardFileMetadata | null {
  if (content?.type !== 'tile' || content.tileType !== 'file') return null;
  const values = Object.fromEntries(content.fields.map(field => [field.key, field.value]));
  const result = WhiteboardFileMetadata.safeParse({ ...values, byteSize: Number(values.byteSize) });
  return result.success ? result.data : null;
}
async function verifiedBytes(boardId: string, metadata: WhiteboardFileMetadata, signal?: AbortSignal) {
  const response = await request(boardId, `/${encodeURIComponent(metadata.assetId)}/content`, { signal });
  const bytes = await readBoundedBytes(response, WHITEBOARD_FILE_LIMITS.bytes);
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  const contentDigest = `sha256:${Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')}`;
  if (bytes.byteLength !== metadata.byteSize || contentDigest !== metadata.contentDigest) throw new Error('FILE_ASSET_INTEGRITY');
  return bytes;
}
export async function uploadBoardFile(boardId: string, file: File, signal?: AbortSignal): Promise<FileTile> {
  if (!file.size || file.size > WHITEBOARD_FILE_LIMITS.bytes) throw new Error('FILE_TOO_LARGE');
  const body = new FormData(); body.append('file', file, file.name); body.append('fileName', file.name);
  const metadata = WhiteboardFileMetadata.parse(await (await request(boardId, '', { method: 'POST', body, signal })).json());
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const contentDigest = `sha256:${Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')}`;
  if (metadata.byteSize !== file.size || metadata.contentDigest !== contentDigest) throw new Error('FILE_ASSET_INTEGRITY');
  await verifiedBytes(boardId, metadata, signal);
  return boardFileTile(metadata);
}
export async function downloadBoardFile(boardId: string, content: CanonicalContentObject, signal?: AbortSignal) {
  const metadata = boardFileMetadata(content);
  if (!metadata) throw new Error('INVALID_FILE_METADATA');
  const bytes = await verifiedBytes(boardId, metadata, signal);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = metadata.fileName;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
