import { emitCandidateComposeSource } from "./cn-candidate-compose-source.js";
import { parseEntryPlan } from "./cn-maintenance-host/entry.js";
import { protectedPrivateBytes } from "./cn-maintenance-host/fixed_transport.js";
import { readOriginalPlanAuthority } from "./cn-maintenance-host/source_plan_authority.js";
import { runtimeDigest } from "./cn-maintenance-host/sealed_runtime.js";
const PROFILE="/etc/workspacex-cn/trusted-tool-binding.json";
function reference(value:any){
 if(!value||Object.keys(value).sort().join(',')!=="path,sha256"||typeof value.path!=="string"||!value.path.startsWith('/etc/workspacex-cn/')||value.path.split('/').includes('..')||!/^[a-f0-9]{64}$/.test(value.sha256))throw Error('CANDIDATE_COMPOSE_AUTHORITY_REF');
 return value as {path:string;sha256:string};
}
/** No stdin authority: independent protected profile/EntryPlan/original writer plan. */
export async function candidateComposeMain(args: readonly string[]) {
 if(args.length!==0||process.platform!=="linux"||process.getuid?.()!==0)throw Error("CANDIDATE_COMPOSE_REJECTED");
 const profileRaw=protectedPrivateBytes(PROFILE),profile=JSON.parse(profileRaw.toString('utf8'));
 const capability=profile.candidateComposeEmitter;
 if(capability?.schemaVersion!==2)throw Error('CANDIDATE_COMPOSE_AUTHORITY_CAPABILITY');
 const entryRef=reference(capability.originalEntryPlanRef),entryRaw=protectedPrivateBytes(entryRef.path,entryRef.sha256);
 const entry=parseEntryPlan(JSON.parse(entryRaw.toString('utf8')));
 const authority=readOriginalPlanAuthority(entry.host,entry.production.toolRevision,profile);
 const optionsRef=reference(capability.optionsRef),optionsRaw=protectedPrivateBytes(optionsRef.path,optionsRef.sha256),options=JSON.parse(optionsRaw.toString('utf8'));
 const manifestRef=reference(options.manifestRef),manifestRaw=protectedPrivateBytes(manifestRef.path,manifestRef.sha256),approved=JSON.parse(manifestRaw.toString('utf8'));
 const configRef=reference(capability.configRef),configRaw=protectedPrivateBytes(configRef.path,configRef.sha256),config=JSON.parse(configRaw.toString('utf8'));
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of process.stdin){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>1024*1024)throw Error("CANDIDATE_COMPOSE_REJECTED");chunks.push(bytes);}
 const request=JSON.parse(Buffer.concat(chunks).toString("utf8"));
 if(runtimeDigest(request.config)!==runtimeDigest(config)||request.options.projectName!==options.projectName||request.options.runtimeDirectory!==options.runtimeDirectory)throw Error('CANDIDATE_COMPOSE_ROOT_INPUT_DRIFT');
 const result=emitCandidateComposeSource(request,authority,approved);
 for(const [ref,raw]of [[entryRef,entryRaw],[optionsRef,optionsRaw],[manifestRef,manifestRaw],[configRef,configRaw]] as const){if(!protectedPrivateBytes(ref.path,ref.sha256).equals(raw))throw Error('CANDIDATE_COMPOSE_AUTHORITY_DRIFT');}
 if(!protectedPrivateBytes(PROFILE).equals(profileRaw))throw Error('CANDIDATE_COMPOSE_AUTHORITY_DRIFT');
 process.stdout.write(JSON.stringify(result)+"\n");
}
if(typeof require!=="undefined" && require.main===module){candidateComposeMain(process.argv.slice(2)).catch(()=>{process.stderr.write("CANDIDATE_COMPOSE_REJECTED\n");process.exitCode=1;});}
