import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateTarget} from './cn-auto-isolated-target.mjs';
function fixture(){
 const source='a'.repeat(40),baseline='b'.repeat(40),attempt='gha-1-1',owner='c'.repeat(20),networkName=`wsx-autop-${owner}-net`,networkId='d'.repeat(64),postgresId='e'.repeat(64),image='sha256:'+'f'.repeat(64),planSha256='0'.repeat(64);
 return {source,baseline,attempt,plan:{planSha256},manifest:{release:'v1.0.0',sourceRevision:source,images:{api:{image}}},binding:{schemaVersion:1,kind:'cn-auto-isolated-target',isolationScope:'attempt-local-docker',identity:{sourceRevision:source,baselineSourceRevision:baseline,attemptId:attempt,release:'v1.0.0'},migrationPlanSha256:planSha256,candidateApiImage:image,database:'workspacex',ownerLabel:owner,networkName,networkId,postgresContainerId:postgresId,postgresImageId:image},network:{Name:networkName,Id:networkId,Internal:true,Labels:{'wsx.auto.owner':owner}},postgres:{Id:postgresId,Image:image,Name:`/wsx-autop-${owner}-pg`,Config:{Labels:{'wsx.auto.owner':owner}},State:{Running:true},HostConfig:{NetworkMode:networkName,PortBindings:{}},NetworkSettings:{Networks:{[networkName]:{NetworkID:networkId}}}},environment:'PGHOST=postgres\nPGPORT=5432\nPGDATABASE=workspacex\nPGSSLMODE=disable\nREDIS_HOST=redis\nREDIS_TLS=false\nWORKSPACEX_DEPLOY_PROFILE=starter\nAPP_DB_PASSWORD=fixture\n',now:10000,mtime:9000};
}
test('admits exact internal attempt-owned target',()=>assert.equal(validateTarget(fixture()).networkName,fixture().binding.networkName));
for(const [name,mutate] of [
 ['external network',v=>v.network.Internal=false],
 ['foreign network',v=>v.network.Id='1'.repeat(64)],
 ['foreign postgres owner',v=>v.postgres.Config.Labels['wsx.auto.owner']='1'.repeat(20)],
 ['production postgres host',v=>v.environment=v.environment.replace('PGHOST=postgres','PGHOST=production.example')],
 ['production redis host',v=>v.environment=v.environment.replace('REDIS_HOST=redis','REDIS_HOST=production.example')],
 ['published postgres port',v=>v.postgres.HostConfig.PortBindings={'5432/tcp':[{HostPort:'5432'}]}],
 ['extra network',v=>v.postgres.NetworkSettings.Networks.production={}],
 ['wrong candidate image',v=>v.binding.candidateApiImage='sha256:'+'2'.repeat(64)],
 ['stale binding',v=>v.now=3609001],
 ['wrong attempt',v=>v.attempt='gha-2-1'],
 ['postgres stopped',v=>v.postgres.State.Running=false],
 ['missing explicit local profile',v=>v.environment=v.environment.replace('WORKSPACEX_DEPLOY_PROFILE=starter','WORKSPACEX_DEPLOY_PROFILE=')],
])test('rejects '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>validateTarget(f),/UNPROVEN/);});
