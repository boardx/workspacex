import {test} from 'node:test';
import assert from 'node:assert/strict';
import {securityStatuses,validateSecurityArtifact} from './board-security-policy.mjs';
const sha='a'.repeat(40),context={startedAt:'2026-09-27T00:00:00Z',endedAt:'2026-09-27T00:30:00Z',runtimeMarker:'unit'};
function synthetic(){
 const at='2026-09-27T00:01:00Z',runtime={sha,buildSha:sha,dirty:false,method:'fresh-server-marker-and-built-chunk-hashes',deploymentMarker:'unit',buildId:'unit',runStartedAt:context.startedAt,buildCreatedAt:at,chunks:[{url:'/unit.js',sha256:'b'.repeat(64),localSha256:'b'.repeat(64)}]};
 const observations=Object.entries(securityStatuses).map(([name,statuses])=>({name,at:name.startsWith('expired-')?'2026-09-27T00:01:03Z':at,status:statuses[0],bytes:1,contentType:name==='owner-image'||name==='viewer-image'?'image/png':'application/json',bodyHash:(statuses[0]===200?'b':'c').repeat(64)}));
 observations.push(...['viewer','commenter'].map(role=>({name:`${role}-ws-write`,at,sync:true,ack:false,error:'FORBIDDEN'})),{name:'owner-ws',at,sync:true},...['tenant-ws','revoked-ws','expired-ws'].map(name=>({name,at:name==='expired-ws'?'2026-09-27T00:01:03Z':at,sync:false,ack:false,closed:true})),{name:'revoked-live-view',at,cleared:true},{name:'expiry-window',at,issuedAt:Date.parse(at)-1000,expiresAt:Date.parse(at)+1000,observedAt:Date.parse(at)+2000},{name:'no-unauthorized-mutation',at,before:{objects:[{id:'unit'}]},after:{objects:[{id:'unit'}]}});
 return{version:1,kind:'board-security',sha,boardId:'a',otherBoardId:'b',runtimeBefore:runtime,runtimeAfter:runtime,observations,identities:{owner:'a',viewer:'b',commenter:'c',outsider:'d',orgId:'a',foreignOrgId:'b'},approved:false,score:null};
}
test('UNIT valid security evidence structure does not award score',()=>{const r=validateSecurityArtifact(synthetic(),sha,context);assert.deepEqual(r.failures,[]);assert.equal(r.score,null);});
test('security rejects outage in place of permission denial, ACK after denied write, duplicate checks, same tenant, and unexpired token',()=>{
 for(const mutate of [r=>r.observations.find(o=>o.name==='viewer-write').status=503,r=>r.observations.find(o=>o.name==='viewer-ws-write').ack=true,r=>r.observations.push(r.observations[0]),r=>r.identities.foreignOrgId='a',r=>r.observations.find(o=>o.name==='expiry-window').observedAt=0,r=>r.runtimeBefore={...r.runtimeBefore,deploymentMarker:'stale'},r=>r.observations.find(o=>o.name==='no-unauthorized-mutation').after={objects:[]}]){const r=synthetic();mutate(r);assert.equal(validateSecurityArtifact(r,sha,context).valid,false);}
});
