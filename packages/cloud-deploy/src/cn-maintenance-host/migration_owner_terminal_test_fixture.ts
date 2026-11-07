import {createHash} from 'node:crypto';
import {authorityWithRelease} from './native_completion_test_fixture';
import {verifyOwnerTerminal} from './migration_owner_terminal';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export function terminalFixture(){
 const f=authorityWithRelease(),id=f.authority.identity,tool=f.authority.toolRevision,generation='d'.repeat(32),h='e'.repeat(64),now=Date.now();
 const files=new Map<string,Buffer>();
 const put=(path:string,value:unknown)=>{const raw=Buffer.from(JSON.stringify(value));files.set(path,raw);return{path,sha256:sha(raw)};};
 const epoch=put(`/etc/workspacex-cn/maintenance-evidence/${id.sourceRevision}/${id.attemptId}/qualified-current-epoch/epoch.json`,{schemaVersion:1,kind:'held-current-epoch-manifest',identity:id,toolRevision:tool,holdGeneration:generation,databases:Object.fromEntries(['workspacex','workspacex_agent','workspacex_memory'].map(n=>[n,{path:'/etc/workspacex-cn/'+n+'.json',sha256:h}])),objectRecovery:{path:'/etc/workspacex-cn/objects.json',sha256:h},beforeHeldObservationSha256:h,afterHeldObservationSha256:h});
 const completion=put(`/etc/workspacex-cn/migration-completion-inputs/${id.sourceRevision}/${id.attemptId}.completed.json`,{schemaVersion:1,scope:'validated-production-migration-completion',sourceRevision:id.sourceRevision,baselineRevision:id.baselineRevision,attemptId:id.attemptId,release:f.release,originalPlanSha256:id.migrationPlanSha256,completionPlanSha256:h,sourceInventorySha256:h,sourceBindingSha256:h,snapshotSha256:h,fullResponseSha256:h,ledgerSha256:h,appliedSqlCount:1,pendingCount:0,driftCount:0,unknownAppliedCount:0,capturedAt:new Date(now).toISOString(),providerFinishedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString(),productionMutationAuthorized:false});
 const candidate=put(`/etc/workspacex-cn/maintenance-candidate/${id.sourceRevision}/${id.attemptId}/candidate-plan.json`,{schemaVersion:1,toolRevision:tool,plan:{identity:id,holdGeneration:generation,epoch:epoch.sha256,migrationCompletionSha256:completion.sha256,artifactSha256:h},artifact:{path:'/etc/workspacex-cn/artifact.json',sha256:h}});
 const marker={operation:'readPublicIdentity',value:{sourceRevision:id.sourceRevision,deploymentMarker:'exact',trustworthy:true}};
 const observation={operation:'readObservation',value:{identity:id,deploymentMarker:'exact',holdPresent:false,queued:0,running:0,writebackPending:0,failedOwnedRuns:0,unhealthyServices:0}};
 const canonicalChecks={status:'passed',lockRetained:true,passedStages:8};
 const browserChecks={login:true,hello:true,asr:true,githubFeedbackRead:true,skillTool:true,pdfDownload:true};
 const receipt=(lane:'canonical'|'browser',checks:unknown)=>put(`/etc/workspacex-cn/maintenance-acceptance/${id.sourceRevision}/${id.attemptId}/${lane}.json`,{schemaVersion:1,kind:lane+'-acceptance-completed',identity:id,deploymentMarker:'exact',observedAt:new Date(now).toISOString(),ownedAcceptanceRunIds:lane==='canonical'?[]:['run-1','run-2','run-3'],checks});
 const publicReceipts={canonical:receipt('canonical',canonicalChecks),browser:receipt('browser',browserChecks)};
 const value={schemaVersion:1,kind:'canonical-migration-owner-evidence-v1',originalPlanSha256:f.authority.sourcePlanSha256,toolRevision:tool,holdGeneration:generation,epoch,completion,candidate,publicReceipts,holdCas:{input:{schemaVersion:1,identity:id,generation,state:'held',sha256:h,device:1,inode:2},cleared:{schemaVersion:1,identity:id,generation,state:'cleared',sha256:h,device:1,inode:3},readback:{schemaVersion:1,identity:id,generation,state:'cleared',sha256:h,device:1,inode:3}},publicTranscript:[marker,{operation:'verifyCanonical',value:{status:'passed',lockRetained:true,passedStages:8}},{operation:'runBrowserSmoke',value:{login:true,hello:true,asr:true,githubFeedbackRead:true,skillTool:true,pdfDownload:true}},marker,marker,observation,marker,observation]};
 const binding={identity:id,deploymentMarker:'exact',observationSamples:2,maximumOutstandingRuns:0};
 const read=(p:string)=>{const b=files.get(p);if(!b)throw Error('missing');return b;};
 return {f,value,binding,read,files,now,run:()=>{const raw=Buffer.from(JSON.stringify(value));return verifyOwnerTerminal(f.authority,raw,sha(raw),binding,f.release,read,now);}};
}
