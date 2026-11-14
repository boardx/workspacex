import { whiteboard as C } from '@repo/contracts';
import { apiUrl } from './api-client';

function sharePath(template: string, token: string): string {
  return template.replace(':token', encodeURIComponent(token));
}

export function publicBoardShareImageUrl(token: string, assetId: string): string {
  return apiUrl(sharePath(C.sharePaths.image, token).replace(':assetId', encodeURIComponent(assetId)));
}

export function fetchPublicBoardShare(token: string, signal: AbortSignal): Promise<Response> {
  return fetch(apiUrl(sharePath(C.sharePaths.read, token)), {
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal,
  });
}
