import {afterEach,describe,expect,it,vi} from 'vitest';
import {ArtifactEmbeddingUsageController} from '../../src/interface/controllers/artifact-embedding-usage.controller';
import {ArtifactEmbeddingOwnershipDenied} from '../../src/application/retrieval/artifact-embedding-accounting';
const operation='00000000-0000-4000-8000-000000000001';
const body={orgId:'org-a',requestId:'00000000-0000-4000-8000-000000000002',startedAt:'2026-10-04T00:00:00.000Z',modelId:'embedding-model'};
afterEach(()=>vi.unstubAllEnvs());
describe('private artifact accounting callback',()=>{
 it('authenticates before parsing and rejects invalid IDs and asserted actors without dispatch',async()=>{
  vi.stubEnv('DEEP_AGENT_SERVICE_INTERNAL_KEY','private-key');const start=vi.fn(),terminal=vi.fn();const controller=new ArtifactEmbeddingUsageController({start,terminal});
  await expect(controller.start('wrong','invalid',null)).rejects.toMatchObject({status:401});
  await expect(controller.start('private-key','invalid',body)).rejects.toMatchObject({status:400});
  await expect(controller.start('private-key',operation,{...body,userId:'forged'})).rejects.toMatchObject({status:400});
  expect(start).not.toHaveBeenCalled();expect(terminal).not.toHaveBeenCalled();
 });
 it('returns a bounded ownership denial and preserves infrastructure failures',async()=>{
  vi.stubEnv('DEEP_AGENT_SERVICE_INTERNAL_KEY','private-key');const start=vi.fn().mockRejectedValueOnce(new ArtifactEmbeddingOwnershipDenied()).mockRejectedValueOnce(new Error('database-unavailable'));const controller=new ArtifactEmbeddingUsageController({start,terminal:vi.fn()});
  await expect(controller.start('private-key',operation,body)).rejects.toMatchObject({status:403,message:'artifact_accounting_ownership_denied'});
  await expect(controller.start('private-key',operation,body)).rejects.toThrow('database-unavailable');
 });
});
