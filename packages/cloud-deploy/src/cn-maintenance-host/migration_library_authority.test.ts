import {describe,it,expect} from 'vitest';
import {verifyExistingMigrationAuthority} from './migration_library';
import {originalAuthorityFixture} from './source_plan_authority_test_fixture';
const legacy='9b25bfa65662b96c0826fe67506b562ea46aa6d0',candidate='5285bef9a6c91bbb9857ede42779aafa64b98f32';
const make=(sourceRevision=candidate)=>originalAuthorityFixture({sourceRevision,baselineRevision:sourceRevision===legacy?'ba6343199f3c834d6a198f83d0c771614292c82b':'a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0',migrationPlanSha256:'a'.repeat(64),attemptId:'runtime-bridge-test'},'c'.repeat(40));
describe('existing migrator uses independently issued original authority',()=>{
 for(const revision of [legacy,candidate])it(`admits actual original plan for ${revision}`,()=>{const f=make(revision);expect(()=>verifyExistingMigrationAuthority(f.authority,`/var/lib/workspacex-cn/releases/${revision}/apps/api/migrations`)).not.toThrow();});
 it('rejects caller-created authority and wrong source path',()=>{const f=make();expect(()=>verifyExistingMigrationAuthority({...f.authority},`/var/lib/workspacex-cn/releases/${candidate}/apps/api/migrations`)).toThrow('ORIGINAL_PLAN_AUTHORITY_REQUIRED');for(const path of [`/var/lib/workspacex-cn/releases/${legacy}/apps/api/migrations`,`/tmp/${candidate}/apps/api/migrations`,`/var/lib/workspacex-cn/releases/${candidate}/../apps/api/migrations`])expect(()=>verifyExistingMigrationAuthority(f.authority,path)).toThrow('EXISTING_MIGRATION_INPUT_BINDING');});
 it('rejects original raw-byte drift and independent profile/tool changes',()=>{const f=make();f.setRaw(Buffer.from('{}'));expect(()=>verifyExistingMigrationAuthority(f.authority,`/var/lib/workspacex-cn/releases/${candidate}/apps/api/migrations`)).toThrow();const g=make();g.profile.toolRevision='0'.repeat(40);expect(()=>verifyExistingMigrationAuthority(g.authority,`/var/lib/workspacex-cn/releases/${candidate}/apps/api/migrations`)).toThrow('ORIGINAL_PLAN_AUTHORITY_DRIFT');});
});
