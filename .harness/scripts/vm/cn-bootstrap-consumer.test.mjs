import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const source='a'.repeat(40),baseline='b'.repeat(40),digest='sha256:'+'c'.repeat(64);
function run(phase,change=()=>{}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phase-consumer-'));
 try{
  const dynamic=phase==='preactivate';
  const value={schemaVersion:1,phase,sourceSha:source,ready:true,readOnlyTransaction:dynamic,productionWriteStatements:0,blockers:[],stateClass:dynamic?'matching-existing':'unknown',checks:{[dynamic?'imageEntrypoint':'sourceEntrypoint']:true,inputContract:true,schemaContract:dynamic,permissionContract:dynamic,agentSeedContract:dynamic,...(dynamic?{migrationLedgerContract:true}:{})},...(dynamic?{imageDigest:digest}:{baselineCompatibility:{baselineSha:baseline,migrationPlanSha256:'d'.repeat(64),baselineSchemaSha256:'f'.repeat(64),readOnlyTransaction:true,productionWriteStatements:0,baselineLedgerContract:true,baselineSchemaContract:true,baselinePermissionContract:true,candidateSchemaContract:false,buildAdmissionOnly:true}})};
  change(value);
  const file=(name,data,prefix='')=>{const out=path.join(dir,name);fs.writeFileSync(out,prefix+JSON.stringify(data)+'\n');return out;};
  const output=path.join(dir,'out.json');const args=[output,phase,'attempt',source,baseline,'2026.10.4-cn.1','12','3600','/browser',file('manifest',{images:Object.fromEntries(['api','web','agent','sandbox'].map(s=>[s,{image:`registry.test/${s}@${digest}`}]))}),file('prior',{}),file('bootstrap',value,'CN_BOOTSTRAP_COMPAT_JSON='),file('runtime',{ready:true},'CN_RUNTIME_ENVIRONMENT_PREFLIGHT_JSON='),file('stable',{passed:true},'CN_STABLE_SECRET_PREFLIGHT '),file('managed',{ready:true},'CN_MANAGED_DATA_PREFLIGHT_JSON='),file('protocol',{})];
  const result=spawnSync(process.execPath,[new URL('./cn-release-preflight-evidence.mjs',import.meta.url).pathname,...args],{encoding:'utf8'});
  return {status:result.status,value:result.status===0?JSON.parse(fs.readFileSync(output)):undefined};
 }finally{fs.rmSync(dir,{recursive:true});}
}
test('baseline plan permits build only without candidate columns',()=>{const r=run('prebuild');assert.equal(r.status,0);const m=r.value.checks['bootstrap.compatibility'].metadata;assert.equal(m.buildAdmissionOnly,true);assert.equal(m.schemaContract,false);assert.equal(m.candidateSchemaContract,false);assert.equal(r.value.buildStarted,false);});
test('static source alone rejected',()=>assert.equal(run('prebuild',b=>delete b.baselineCompatibility).status,1));
test('baseline identity mismatch rejected',()=>assert.equal(run('prebuild',b=>b.baselineCompatibility.baselineSha=source).status,1));
test('prebuild fabricated candidate schema rejected',()=>assert.equal(run('prebuild',b=>b.checks.schemaContract=true).status,1));
test('missing candidate fields after migration rejects activation proof',()=>assert.equal(run('preactivate',b=>b.checks.schemaContract=false).status,1));
test('missing candidate migration checksum rejects activation proof',()=>assert.equal(run('preactivate',b=>b.checks.migrationLedgerContract=false).status,1));
test('full migrated candidate evidence accepted by assembler only',()=>assert.equal(run('preactivate').status,0));
test('relabelled static proof rejected',()=>assert.equal(run('preactivate',b=>{b.readOnlyTransaction=false;b.checks.schemaContract=false;b.stateClass='unknown';}).status,1));
