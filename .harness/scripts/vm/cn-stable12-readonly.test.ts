import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {canonicalLiveConsumers,equalSecret,compareKey} from './cn-stable12-readonly';
it('derives the five production generated-key identities from the actual canonical mapper',async()=>{
 const source=await readFile(new URL('../../../packages/cloud-deploy/src/runtime-environment.ts',import.meta.url),'utf8');
 const maps=canonicalLiveConsumers(source),keys=new Set(Object.values(maps).flatMap(Object.values));
 expect([...keys].sort()).toEqual(['admin-password','email-verification','model-cipher','native-binding','service-key']);
 expect(maps.bootstrap).toEqual({PROVISION_ADMIN_PASSWORD:'admin-password'});expect(maps.api.APP_DB_PASSWORD).toBeUndefined();
 expect(()=>canonicalLiveConsumers(source.replace('MODEL_CREDENTIAL_KEY: secret["model-cipher"]','MODEL_CREDENTIAL_KEY: secret["native-binding"]'))).toThrow('STABLE_SECRET_CONSUMER_DRIFT');
});
it('never interprets an absent or different value as equality',()=>{expect(equalSecret(undefined,undefined)).toBe(false);expect(equalSecret('a','a')).toBe(true);expect(equalSecret('a','b')).toBe(false);expect(equalSecret('a','aa')).toBe(false);});
it('reports missing legacy and unconsumed keys as unknown, never fabricated twelve-key continuity',()=>{
 const key=compareKey('app-password','synthetic',undefined,[],true,false);expect(key.status).toBe('unknown');expect(key.legacySame).toBeNull();expect(key.liveSame).toBeNull();
 expect(compareKey('admin-password','synthetic',undefined,['synthetic'],true,false).status).toBe('live-same');
 expect(compareKey('admin-password','synthetic','synthetic',['different'],true,true).status).toBe('mismatch');
 expect(JSON.stringify(key)).not.toContain('synthetic');
});
