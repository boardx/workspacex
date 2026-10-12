import assert from 'node:assert/strict';
import test from 'node:test';
import {diagnostic,mark} from './diagnostic';
import {readFileSync} from 'node:fs';
test('unknown secret error never echoed',()=>{mark('SECRET_STAGE');const x=diagnostic(Object.assign(Error('postgres://user:SECRET@host/private'),{code:'SECRET_CODE',query:'SECRET_QUERY'}));assert.equal(x.stage,'unknown');assert.equal(x.reason,'UNCLASSIFIED');assert(!JSON.stringify(x).includes('SECRET'));});
test('real psql shape preserves only approved SQLSTATE and hash',()=>{mark('create-roles');const x=diagnostic(Object.assign(Error('sensitive command'),{code:1,stderr:'ERROR:  42501: secret text\n'}));assert.equal(x.stage,'create-roles');assert.equal(x.sqlstate,'42501');assert.equal(x.childExit,1);assert(!JSON.stringify(x).includes('secret'));assert.equal(x.stderrSha256.length,64);});
test('cause retains original failure classification under recovery assertion',()=>{const x=diagnostic(Error('RECOVERY_DID_NOT_COMPLETE',{cause:Object.assign(Error('untrusted pg text'),{code:'42703'})}));assert.equal(x.reason,'RECOVERY_DID_NOT_COMPLETE');assert.equal(x.sqlstate,'42703');});
test('fixed driver prefix safe and causes bounded',()=>{const e=Error('ORIGINAL_CATCH_NOT_COMPLETED: secret');(e as any).cause=e;assert.equal(diagnostic(e).reason,'ORIGINAL_CATCH_NOT_COMPLETED');assert(!JSON.stringify(diagnostic(e)).includes('secret'));});
test('controller wrapper preserves fixed original actor CAS rejection',()=>{mark('controller-start');const v=diagnostic(Error('ORIGINAL_CATCH_NOT_COMPLETED',{cause:Error('ACTOR_LOGIN_PEER_CAS')}));assert.equal(v.stage,'controller-start');assert.equal(v.reason,'ACTOR_LOGIN_PEER_CAS');});
test('every additional error code is an exact original source literal',()=>{
 const fixed=JSON.parse(readFileSync(new URL('./fixed-error-codes.json',import.meta.url),'utf8'));
 for(const [sources,reasons,prefix] of [[fixed.actorSources,fixed.actorReasons,'ACTOR_'],[fixed.routeSources,fixed.routeReasons,'']] as const){
  const texts=sources.map((p:string)=>readFileSync(new URL('../../../'+p,import.meta.url),'utf8')).join('\n');
  assert.equal(new Set(reasons).size,reasons.length);
  for(const reason of reasons){const literal=reason.slice(prefix.length);assert.match(literal,/^[A-Z_]+$/);assert(texts.includes("'"+literal+"'")||texts.includes('"'+literal+'"'));}
 }
});
test('candidate and route failures survive wrapper but arbitrary actor text cannot',()=>{
 for(const code of ['ACTOR_CANDIDATE_PLAN_DRIFT','ACTOR_CANDIDATE_LIVE_DB_DRIFT','NATIVE_COMPLETION_FRESHNESS']){
  const value=diagnostic(Error('ORIGINAL_CATCH_NOT_COMPLETED',{cause:Error(code+': secret SQL password')}));
  assert.equal(value.reason,code);assert(!JSON.stringify(value).includes('secret'));
 }
 assert.equal(diagnostic(Error('ACTOR_SECRET_PASSWORD')).reason,'UNCLASSIFIED');
});
test('cause cycle and excessive depth are bounded',()=>{
 const cycle=Error('ACTOR_CANDIDATE_PLAN_DRIFT');(cycle as any).cause=cycle;
 assert.equal(diagnostic(cycle).reason,'ACTOR_CANDIDATE_PLAN_DRIFT');
 let e=Error('ACTOR_CANDIDATE_PLAN_DRIFT');for(let i=0;i<4;i++)e=Error('unknown',{cause:e});
 assert.equal(diagnostic(e).reason,'UNCLASSIFIED');
});
