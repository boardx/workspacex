import {runtimeDigest} from './sealed_runtime';
import {createHash} from 'node:crypto';
import {readOriginalPlanAuthority} from './source_plan_authority';
import type {MaintenanceIdentity} from '../cn-maintenance-release';
export function originalAuthorityFixture(identity:MaintenanceIdentity,toolRevision:string,approvedArchive?:unknown){
 const digest='e'.repeat(64),source={schemaVersion:1,mode:'maintenance-all-writer-fence',productionActionsAuthorized:true,runtimeSessionBootstrapAuthorized:true,identity,toolRevision};
 if(approvedArchive!==undefined)Object.assign(source,{preholdArchivePolicy:approvedArchive});
 let raw:Buffer=Buffer.from(JSON.stringify(source)+'\n');const pin=createHash('sha256').update(raw).digest('hex');
 const host={identity,writerPlanPath:`/etc/workspacex-cn/maintenance-host/${identity.sourceRevision}/${identity.attemptId}/writer-plan.json`,writerPlanSha256:pin,writerPlanCanonicalSha256:runtimeDigest(source),hold:{path:'/usr/local/lib/workspacex-cn/cn_maintenance_hold.py',sha256:digest},writerFence:{path:'/usr/local/lib/workspacex-cn/host_transport.py',sha256:digest}};
 const profile:any={toolRevision,maintenanceSourceOperations:{schemaVersion:1,sourcePath:'.harness/scripts/vm/maintenance_source_operations.py',sha256:digest},filesSha256:{'.harness/scripts/vm/maintenance_source_operations.py':digest},installedFilesSha256:{[host.hold.path]:digest,[host.writerFence.path]:digest,'/usr/local/lib/workspacex-cn/maintenance_source_operations.py':digest},originalWriterPlan:{path:host.writerPlanPath,sha256:pin}};
 const authority=readOriginalPlanAuthority(host,toolRevision,profile,path=>path==='/etc/workspacex-cn/trusted-tool-binding.json'?Buffer.from(JSON.stringify(profile)):raw);
 return {authority,host,profile,setRaw:(bytes:Buffer)=>{raw=bytes;}};
}
