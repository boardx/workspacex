import { expect, it } from 'vitest';
import { wave2Runtime } from '@repo/contracts';
import { safeSkillImportFailure } from '../e2e/support/skill-import-diagnostics';
it('uses the actual canonical error union and exports no other response fields',()=>{
 for(const reasonCode of wave2Runtime.operations.importSkillFromUrl.err)expect(safeSkillImportFailure({reasonCode,message:'PRIVATE',url:'PRIVATE',token:'PRIVATE'},422)).toBe(`SKILL_IMPORT_HTTP status=422 reasonCode=${reasonCode}`);
});
it('rejects unknown, nonscalar, missing and inherited codes',()=>{
 for(const body of [{reasonCode:'PRIVATE_TOKEN'},{reasonCode:{private:'PRIVATE'}},{message:'PRIVATE'},null,Object.create({reasonCode:'IMPORT_FETCH_FAILED'})])expect(safeSkillImportFailure(body,422)).toBe('SKILL_IMPORT_HTTP status=422 reasonCode=UNKNOWN');
});
it('does not execute stateful code accessors',()=>{
 let reads=0;const body=Object.defineProperty({},'reasonCode',{get(){reads++;return reads===1?'IMPORT_FETCH_FAILED':'PRIVATE';}});
 expect(safeSkillImportFailure(body,422)).toBe('SKILL_IMPORT_HTTP status=422 reasonCode=UNKNOWN');expect(reads).toBe(0);
});
it('does not replace the HTTP failure when diagnostic descriptor lookup throws',()=>{
 expect(safeSkillImportFailure(new Proxy({},{getOwnPropertyDescriptor(){throw Error('PRIVATE');}}),422)).toBe('SKILL_IMPORT_HTTP status=422 reasonCode=UNKNOWN');
});
