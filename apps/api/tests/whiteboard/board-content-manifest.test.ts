import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeBoardContentManifest, encodeBoardContentManifest, validateBoardContentManifest } from '../../src/domain/whiteboard/content-manifest';

const digest = (character: string) => character.repeat(64);
const checkpoint = { key: `tenants/a/boards/b/checkpoint/sha256/${digest('a')}`, plainDigest: digest('b'), cipherDigest: digest('a'), sizeBytes: 9, throughSeq: 2 };
const tail = [
  { key: `tenants/a/boards/b/update/sha256/${digest('c')}`, plainDigest: digest('d'), cipherDigest: digest('c'), sizeBytes: 4, fromSeq: 3, throughSeq: 4 },
  { key: `tenants/a/boards/b/update/sha256/${digest('e')}`, plainDigest: digest('f'), cipherDigest: digest('e'), sizeBytes: 5, fromSeq: 5, throughSeq: 5 },
];
const manifest = {
  manifestVersion: 1 as const,
  boardId: '0199aabb-ccdd-7eef-8abc-0123456789ab', epoch: 1, headSeq: 5, schemaVersion: 1,
  checkpoint, tail, parentManifestDigest: null, tenantKeyVersion: 2, createdAt: '2026-09-24T08:00:00.000Z',
};

const localeFixture = fileURLToPath(new URL('./fixtures/board-content-manifest-canonical.json', import.meta.url));

function encodeFixtureInLocale(locale: string): { locale: string; base64: string; digest: string } {
  const script = `
    import { readFileSync } from 'node:fs';
    import { createHash } from 'node:crypto';
    import { encodeBoardContentManifest } from './src/domain/whiteboard/content-manifest.ts';
    const manifest = JSON.parse(readFileSync(process.argv[1], 'utf8'));
    const bytes = encodeBoardContentManifest(manifest);
    process.stdout.write(JSON.stringify({
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      base64: Buffer.from(bytes).toString('base64'),
      digest: createHash('sha256').update(bytes).digest('hex'),
    }));
  `;
  return JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, localeFixture], {
    cwd: process.cwd(),
    env: { ...process.env, LANG: locale, LC_ALL: locale },
    encoding: 'utf8',
  })) as { locale: string; base64: string; digest: string };
}

describe('Board content manifest', () => {
  it('has one canonical byte encoding independent of object property order', () => {
    const reordered = { tail, checkpoint, createdAt: manifest.createdAt, tenantKeyVersion: 2, parentManifestDigest: null, schemaVersion: 1, headSeq: 5, epoch: 1, boardId: manifest.boardId, manifestVersion: 1 };
    expect(encodeBoardContentManifest(reordered)).toEqual(encodeBoardContentManifest(manifest));
    expect(decodeBoardContentManifest(encodeBoardContentManifest(manifest))).toEqual(manifest);
  });

  it('has identical canonical bytes and digest across process locales', () => {
    const english = encodeFixtureInLocale('en_US.UTF-8');
    const czech = encodeFixtureInLocale('cs_CZ.UTF-8');
    expect(english.locale).toBe('en-US');
    expect(czech.locale).toBe('cs-CZ');
    expect(czech.base64).toBe(english.base64);
    expect(czech.digest).toBe(english.digest);
    expect(english.digest).toBe('15427bc46cb812a56113c2366bf1c43d2c90429c855e2ef8e0c58109aaeaee19');
  });

  it('rejects unknown fields and non-canonical sequence ranges', () => {
    expect(() => validateBoardContentManifest({ ...manifest, unexpected: true })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => validateBoardContentManifest({ ...manifest, tail: [{ ...tail[0], fromSeq: 4 }] })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => validateBoardContentManifest({ ...manifest, tail: [tail[0]] })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => validateBoardContentManifest({ ...manifest, checkpoint: { ...checkpoint, throughSeq: 6 } })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
});
