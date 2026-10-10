/** Local immutable-source authority fixture, no production files or credentials. */
import {createHash} from 'node:crypto';
import {originalAuthorityFixture} from './source_plan_authority_test_fixture';
import {readOriginalPlanAuthority} from './source_plan_authority';
import type {MaintenanceIdentity} from '../cn-maintenance-release';
export const newReleaseIdentity={sourceRevision:'5285bef9a6c91bbb9857ede42779aafa64b98f32',baselineRevision:'a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0',migrationPlanSha256:'a'.repeat(64),attemptId:'native-release'};
export function authorityWithRelease(identity:MaintenanceIdentity=newReleaseIdentity,tool='b'.repeat(40),release='2026.10.10-cn.1',options:{manifestSource?:string;config?:unknown}={}){
 const f=originalAuthorityFixture(identity,tool),store=new Map<string,Buffer>();
 const put=(name:string,value:unknown)=>{const path='/etc/workspacex-cn/'+name,raw=Buffer.from(JSON.stringify(value));store.set(path,raw);return {path,sha256:createHash('sha256').update(raw).digest('hex')};};
 const manifest=put('native-release-manifest.json',{sourceRevision:options.manifestSource??identity.sourceRevision,release});
 f.profile.candidateComposeEmitter={optionsRef:put('native-release-options.json',{manifestRef:manifest}),configRef:put('native-release-config.json',options.config??{provision:{release}})};
 store.set(f.host.writerPlanPath,Buffer.from(JSON.stringify(f.authority.sourcePlan)+'\n'));
 const read=(path:string)=>path==='/etc/workspacex-cn/trusted-tool-binding.json'?Buffer.from(JSON.stringify(f.profile)):Buffer.from(store.get(path)??'missing');
 const authority=readOriginalPlanAuthority(f.host,tool,f.profile,read);
 return {...f,authority,read,store,put,release};
}
