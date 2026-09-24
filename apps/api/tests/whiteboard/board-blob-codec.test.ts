import { describe, expect, it } from 'vitest';
import { AesGcmBoardBlobCodec, EnvBoardTenantKeyResolver, KmsBoardTenantKeyResolver, type BoardTenantKeyResolver } from '../../src/infrastructure/whiteboard/aes-gcm-board-blob-codec';

const resolver: BoardTenantKeyResolver = { async resolve() { return new Uint8Array(32).fill(7); } };

describe('AesGcmBoardBlobCodec', () => {
  it('encrypts bytes and authenticates tenant context without plaintext fallback', async () => {
    const codec = new AesGcmBoardBlobCodec(resolver), plaintext = Buffer.from('private board content');
    const encoded = await codec.encrypt({ tenantId: 'org-a', tenantKeyVersion: 1, plaintext });
    expect(Buffer.from(encoded.ciphertext)).not.toContain(plaintext);
    expect(await codec.decrypt({ ...encoded, tenantId: 'org-a', expectedPlainDigest: encoded.plainDigest })).toEqual(new Uint8Array(plaintext));
    await expect(codec.decrypt({ ...encoded, tenantId: 'org-b', expectedPlainDigest: encoded.plainDigest })).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
  });

  it('rejects tampering and a missing tenant key instead of returning plaintext', async () => {
    const codec = new AesGcmBoardBlobCodec(resolver), encoded = await codec.encrypt({ tenantId: 'org-a', tenantKeyVersion: 1, plaintext: Buffer.from('secret') });
    const tampered = new Uint8Array(encoded.ciphertext); tampered[tampered.length - 1]! ^= 1;
    await expect(codec.decrypt({ ...encoded, ciphertext: tampered, tenantId: 'org-a', expectedPlainDigest: encoded.plainDigest })).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    await expect(new EnvBoardTenantKeyResolver({}).resolve('org-a', 1)).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
  });

  it('derives tenant-separated keys from a versioned base key', async () => {
    const master = Buffer.alloc(32, 3).toString('base64'), keys = new EnvBoardTenantKeyResolver({ WORKSPACEX_BOARD_CONTENT_KEYS: JSON.stringify({ 4: master }) });
    expect(await keys.resolve('org-a', 4)).not.toEqual(await keys.resolve('org-b', 4));
    await expect(keys.resolve('org-a', 5)).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
  });

  it('rejects environment-held production keys', async () => {
    const master = Buffer.alloc(32, 3).toString('base64');
    await expect(new EnvBoardTenantKeyResolver({ NODE_ENV: 'production', WORKSPACEX_BOARD_CONTENT_KEYS: JSON.stringify({ 1: master }) }).resolve('org-a', 1))
      .rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE', message: 'environment board keys are development-only' });
  });

  it('resolves an exact version from KMS without caching credentials or accepting fallback versions', async () => {
    let calls = 0;
    const resolver = new KmsBoardTenantKeyResolver({
      async resolveVersion(input) { calls += 1; return { version: input.version, keyMaterial: new Uint8Array(32).fill(calls) }; },
    });
    const first = await resolver.resolve('org-a', 7), rotatedCredentials = await resolver.resolve('org-a', 7);
    expect(calls).toBe(2); expect(first).not.toEqual(rotatedCredentials);
    await expect(new KmsBoardTenantKeyResolver({ async resolveVersion() { return { version: 6, keyMaterial: new Uint8Array(32) }; } }).resolve('org-a', 7))
      .rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
  });

  it('sanitizes KMS failures', async () => {
    const resolver = new KmsBoardTenantKeyResolver({ async resolveVersion() { throw new Error('secret ARN and token'); } });
    await expect(resolver.resolve('org-a', 1)).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE', message: 'versioned board key service is unavailable' });
  });
});
