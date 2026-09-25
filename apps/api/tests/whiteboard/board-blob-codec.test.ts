import { createCipheriv, createHash, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AesGcmBoardBlobCodec, EnvBoardTenantKeyResolver, KmsBoardTenantKeyResolver, type BoardTenantKeyResolver } from '../../src/infrastructure/whiteboard/aes-gcm-board-blob-codec';

const resolver: BoardTenantKeyResolver = { currentKeyId: 'test-board-key', async resolve() { return new Uint8Array(32).fill(7); } };

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
    const missing = new EnvBoardTenantKeyResolver({});
    await expect(missing.resolve('org-a', missing.currentKeyId, 1)).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
  });

  it('derives tenant-separated keys from a versioned base key', async () => {
    const master = Buffer.alloc(32, 3).toString('base64'), keys = new EnvBoardTenantKeyResolver({ WORKSPACEX_BOARD_CONTENT_KEYS: JSON.stringify({ 4: master }) });
    expect(await keys.resolve('org-a', keys.currentKeyId, 4)).not.toEqual(await keys.resolve('org-b', keys.currentKeyId, 4));
    await expect(keys.resolve('org-a', keys.currentKeyId, 5)).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
  });

  it('rejects environment-held production keys', async () => {
    const master = Buffer.alloc(32, 3).toString('base64');
    const keys = new EnvBoardTenantKeyResolver({ NODE_ENV: 'production', WORKSPACEX_BOARD_CONTENT_KEYS: JSON.stringify({ 1: master }) });
    await expect(keys.resolve('org-a', keys.currentKeyId, 1))
      .rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE', message: 'environment board keys are development-only' });
  });

  it('resolves an exact immutable version from KMS without accepting fallback versions', async () => {
    let calls = 0;
    const resolver = new KmsBoardTenantKeyResolver({
      currentKeyId: 'kms-board-key',
      async resolveVersion(input) { calls += 1; return { keyId: input.keyId, version: input.version, keyMaterial: new Uint8Array(32).fill(7) }; },
    });
    const first = await resolver.resolve('org-a', resolver.currentKeyId, 7), rotatedCredentials = await resolver.resolve('org-a', resolver.currentKeyId, 7);
    expect(calls).toBe(2); expect(first).toEqual(rotatedCredentials);
    let material = 1;
    const mutable = new KmsBoardTenantKeyResolver({ currentKeyId: 'kms-board-key', async resolveVersion(input) { return { keyId: input.keyId, version: input.version, keyMaterial: new Uint8Array(32).fill(material) }; } });
    await mutable.resolve('org-a', mutable.currentKeyId, 7); material = 2;
    await expect(mutable.resolve('org-a', mutable.currentKeyId, 7)).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
    const wrongVersion = new KmsBoardTenantKeyResolver({ currentKeyId: 'kms-board-key', async resolveVersion(input) { return { keyId: input.keyId, version: 6, keyMaterial: new Uint8Array(32) }; } });
    await expect(wrongVersion.resolve('org-a', wrongVersion.currentKeyId, 7))
      .rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
  });

  it('decrypts historical content after adding a new key version', async () => {
    const versions = new Map([[1, new Uint8Array(32).fill(1)]]);
    const codec = new AesGcmBoardBlobCodec(new KmsBoardTenantKeyResolver({
      currentKeyId: 'kms-board-key',
      async resolveVersion(input) {
        const keyMaterial = versions.get(input.version);
        if (!keyMaterial) throw new Error('missing');
        return { keyId: input.keyId, version: input.version, keyMaterial: new Uint8Array(keyMaterial) };
      },
    }));
    const old = await codec.encrypt({ tenantId: 'org-a', tenantKeyVersion: 1, plaintext: Buffer.from('historical board') });
    versions.set(2, new Uint8Array(32).fill(2));
    await codec.encrypt({ tenantId: 'org-a', tenantKeyVersion: 2, plaintext: Buffer.from('new board') });
    await expect(codec.decrypt({ ...old, tenantId: 'org-a', expectedPlainDigest: old.plainDigest }))
      .resolves.toEqual(new Uint8Array(Buffer.from('historical board')));
  });

  it('sanitizes KMS failures', async () => {
    const resolver = new KmsBoardTenantKeyResolver({ currentKeyId: 'kms-board-key', async resolveVersion() { throw new Error('secret ARN and token'); } });
    await expect(resolver.resolve('org-a', resolver.currentKeyId, 1)).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE', message: 'versioned board key service is unavailable' });
  });

  it('uses a random per-object data key wrapped by exact key identity and version', async () => {
    const seen: Array<{ tenantId: string; keyId: string; version: number }> = [];
    const codec = new AesGcmBoardBlobCodec(new KmsBoardTenantKeyResolver({
      currentKeyId: 'kms/key-a',
      async resolveVersion(input) { seen.push(input); return { ...input, keyMaterial: new Uint8Array(32).fill(4) }; },
    }));
    const first = await codec.encrypt({ tenantId: 'org-a', tenantKeyVersion: 3, plaintext: Buffer.from('same') });
    const second = await codec.encrypt({ tenantId: 'org-a', tenantKeyVersion: 3, plaintext: Buffer.from('same') });
    expect(first.ciphertext[0]).toBe(2);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
    expect(Buffer.from(first.ciphertext).includes(Buffer.from('kms/key-a'))).toBe(true);
    expect(seen).toContainEqual({ tenantId: 'org-a', keyId: 'kms/key-a', version: 3 });
    await expect(codec.decrypt({ ...first, tenantId: 'org-a', expectedPlainDigest: first.plainDigest })).resolves.toEqual(new Uint8Array(Buffer.from('same')));
    const wrongVersion = { ...first, tenantKeyVersion: 4 };
    await expect(codec.decrypt({ ...wrongVersion, tenantId: 'org-a', expectedPlainDigest: first.plainDigest })).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
  });

  it('decrypts legacy v1 ciphertext during envelope migration', async () => {
    const master = new Uint8Array(32).fill(8);
    const plaintext = Buffer.from('legacy board content'), version = 2, nonce = Buffer.alloc(12, 3);
    const key = hkdfSync('sha256', master, Buffer.from('org-a'), Buffer.from(`workspacex-board-content:v${version}`), 32);
    const keys: BoardTenantKeyResolver = { currentKeyId: 'legacy-key', async resolve() { return new Uint8Array(key); } };
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), nonce);
    cipher.setAAD(Buffer.from(`workspacex-board-content\0org-a\0${version}`));
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const ciphertext = Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), body]);
    const digest = createHash('sha256').update(plaintext).digest('hex');
    const cipherDigest = createHash('sha256').update(ciphertext).digest('hex');
    await expect(new AesGcmBoardBlobCodec(keys).decrypt({
      ciphertext, cipherDigest, plainDigest: digest, expectedPlainDigest: digest,
      sizeBytes: ciphertext.byteLength, contentType: 'application/octet-stream', tenantId: 'org-a', tenantKeyVersion: version,
    })).resolves.toEqual(new Uint8Array(plaintext));
  });
});
