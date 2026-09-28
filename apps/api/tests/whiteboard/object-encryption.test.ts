import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OssObjectStore, type OssClientPort } from '../../src/infrastructure/storage/oss-object-store';
import { SecureWhiteboardObjectStore, whiteboardObjectEncryptionPolicy } from '../../src/infrastructure/whiteboard/secure-object-store';

function fixture() {
  const objects = new Map<string, { bytes: Buffer; headers: Record<string, string> }>();
  const client: OssClientPort = {
    async getBucketVersioning() { return {}; }, async getBucketACL() { return { acl: 'private' }; },
    async put(key, bytes, options) {
      if (objects.has(key)) throw { code: 'FileAlreadyExists' };
      objects.set(key, { bytes: Buffer.from(bytes), headers: {
        ...options.headers, 'content-length': String(bytes.length), 'content-type': options.mime,
        etag: createHash('md5').update(bytes).digest('hex'),
      } });
    },
    async get(key) { const value=objects.get(key); if(!value)throw{code:'NoSuchKey'};return{content:value.bytes,headers:value.headers}; },
    async head(key) { const value=objects.get(key);if(!value)throw{code:'NoSuchKey'};return{headers:value.headers}; },
    async delete(key) { objects.delete(key); }, async list(){return{objects:[]};},
  };
  const raw = new OssObjectStore(client, 'private-bucket', 'deployments/board');
  return { raw, objects };
}

describe('whiteboard object encryption boundary', () => {
  it('requires explicit hosted SSE and validates KMS configuration without echoing its value', () => {
    expect(() => whiteboardObjectEncryptionPolicy({ WORKSPACEX_OBJECT_STORE:'oss' })).toThrow('WHITEBOARD_ENCRYPTION_REQUIRED');
    expect(whiteboardObjectEncryptionPolicy({ WORKSPACEX_OBJECT_STORE:'oss', WORKSPACEX_BOARD_OBJECT_SSE:'AES256' })).toEqual({backend:'oss',encryption:{algorithm:'AES256'}});
    const keyId='kms/board-production';
    expect(whiteboardObjectEncryptionPolicy({WORKSPACEX_OBJECT_STORE:'oss',WORKSPACEX_BOARD_OBJECT_SSE:'KMS',WORKSPACEX_BOARD_OBJECT_KMS_KEY_ID:keyId})).toEqual({backend:'oss',encryption:{algorithm:'KMS',keyId}});
    try { whiteboardObjectEncryptionPolicy({WORKSPACEX_OBJECT_STORE:'oss',WORKSPACEX_BOARD_OBJECT_SSE:'KMS',WORKSPACEX_BOARD_OBJECT_KMS_KEY_ID:'secret value'}); }
    catch(error) { expect(String(error)).not.toContain('secret value'); }
  });

  it.each([{algorithm:'AES256'} as const,{algorithm:'KMS',keyId:'kms/board'} as const])('writes and reads back $algorithm metadata before success',async encryption=>{
    const f=fixture(),store=new SecureWhiteboardObjectStore(f.raw,{backend:'oss',encryption});
    await store.putOnce('whiteboards/tenants/a/source',Buffer.from('board'),'application/json');
    const headers=f.objects.values().next().value!.headers;
    expect(headers['x-oss-server-side-encryption']).toBe(encryption.algorithm);
    expect(headers['x-oss-server-side-encryption-key-id']??null).toBe(encryption.algorithm==='KMS'?encryption.keyId:null);
  });

  it('does not change the shared store default behavior for non-whiteboard callers',async()=>{
    const f=fixture();await f.raw.putOnce('artifact',Buffer.from('x'),'text/plain');
    expect(f.objects.values().next().value!.headers['x-oss-server-side-encryption']).toBeUndefined();
  });

  it('fails closed when readback metadata is absent or does not match policy',async()=>{
    const f=fixture(),store=new SecureWhiteboardObjectStore(f.raw,{backend:'oss',encryption:{algorithm:'AES256'}});
    const original=f.raw.headEncryption.bind(f.raw);f.raw.headEncryption=async()=>({algorithm:'KMS',keyId:'other'});
    await expect(store.putOnce('whiteboards/tenants/a/source',Buffer.from('board'),'application/json')).rejects.toThrow('encryption verification failed');
    f.raw.headEncryption=original;
  });
});
