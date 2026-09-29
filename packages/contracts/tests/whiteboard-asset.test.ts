import { describe, expect, it } from 'vitest';
import { WHITEBOARD_DOWNLOAD_GRANT_TTL_SECONDS, WhiteboardAssetDownloadGrant, WhiteboardAssetDownloadToken, operations } from '../src/whiteboard-asset';

describe('whiteboard asset delivery contract', () => {
  it('keeps grants short-lived, authenticated-path based and non-public', () => {
    expect(WHITEBOARD_DOWNLOAD_GRANT_TTL_SECONDS).toBeLessThanOrEqual(300);
    expect(WhiteboardAssetDownloadGrant.parse({
      downloadPath: '/whiteboards/20000000-0000-4000-8000-000000000001/assets/downloads/token',
      expiresAt: '2026-09-28T00:02:00.000Z',
      oneTime: false,
    })).toBeTruthy();
    expect(() => WhiteboardAssetDownloadGrant.parse({ downloadPath: 'https://bucket.example/object', expiresAt: '2026-09-28T00:02:00.000Z', oneTime: false })).toThrow();
    expect(WhiteboardAssetDownloadToken.parse('payload.signature')).toBe('payload.signature');
    expect(operations.issueDownloadGrant.path).toContain('/download-grant');
    expect(operations.downloadWithGrant.path).toContain('/downloads/:token');
  });
});
