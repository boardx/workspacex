import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { WHITEBOARD_DOWNLOAD_GRANT_TTL_SECONDS, WhiteboardAssetDownloadToken } from '@repo/contracts/whiteboard-asset';
import type { Principal } from '../../domain/principal';

export interface BoardAssetDownloadClaim {
  readonly boardId: string;
  readonly assetId: string;
  readonly principalHash: string;
  readonly expiresAtSeconds: number;
  readonly nonce: string;
}

export interface BoardAssetDownloadGrantSigner {
  issue(principal: Principal, boardId: string, assetId: string, now: Date): { token: string; expiresAt: Date };
  verify(principal: Principal, boardId: string, token: string, now: Date): BoardAssetDownloadClaim | null;
}

export class DisabledBoardAssetDownloadGrantSigner implements BoardAssetDownloadGrantSigner {
  issue(): never { throw new Error('DOWNLOAD_GRANT_UNAVAILABLE'); }
  verify(): null { return null; }
}

const principalHash = (principal: Principal) => createHash('sha256')
  .update(`${principal.orgId}\0${principal.userId}`)
  .digest('hex');

export class HmacBoardAssetDownloadGrantSigner implements BoardAssetDownloadGrantSigner {
  private readonly key: Buffer;
  constructor(secret: string | Uint8Array) {
    this.key = Buffer.from(secret);
    if (this.key.byteLength < 32) throw new Error('BOARD_DOWNLOAD_SIGNING_KEY_TOO_SHORT');
  }
  issue(principal: Principal, boardId: string, assetId: string, now: Date) {
    const expiresAt = new Date(now.getTime() + WHITEBOARD_DOWNLOAD_GRANT_TTL_SECONDS * 1000);
    const claim: BoardAssetDownloadClaim = {
      boardId, assetId, principalHash: principalHash(principal),
      expiresAtSeconds: Math.floor(expiresAt.getTime() / 1000),
      nonce: randomBytes(16).toString('base64url'),
    };
    const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
    const signature = createHmac('sha256', this.key).update(`whiteboard-asset-v1:${payload}`).digest('base64url');
    return { token: `${payload}.${signature}`, expiresAt };
  }
  verify(principal: Principal, boardId: string, token: string, now: Date): BoardAssetDownloadClaim | null {
    const parsed = WhiteboardAssetDownloadToken.safeParse(token);
    if (!parsed.success) return null;
    const [payload, supplied] = token.split('.');
    if (!payload || !supplied) return null;
    const expected = createHmac('sha256', this.key).update(`whiteboard-asset-v1:${payload}`).digest();
    let signature: Buffer;
    try { signature = Buffer.from(supplied, 'base64url'); } catch { return null; }
    if (signature.byteLength !== expected.byteLength || !timingSafeEqual(signature, expected)) return null;
    let claim: BoardAssetDownloadClaim;
    try { claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as BoardAssetDownloadClaim; } catch { return null; }
    if (!claim || claim.boardId !== boardId || claim.principalHash !== principalHash(principal)
      || !Number.isSafeInteger(claim.expiresAtSeconds) || claim.expiresAtSeconds <= Math.floor(now.getTime() / 1000)
      || typeof claim.assetId !== 'string' || typeof claim.nonce !== 'string') return null;
    return claim;
  }
}

export function boardAssetDownloadGrantSignerFromEnv(env: NodeJS.ProcessEnv = process.env): BoardAssetDownloadGrantSigner {
  const secret = env.WORKSPACEX_BOARD_DOWNLOAD_SIGNING_KEY;
  return secret ? new HmacBoardAssetDownloadGrantSigner(secret) : new DisabledBoardAssetDownloadGrantSigner();
}
