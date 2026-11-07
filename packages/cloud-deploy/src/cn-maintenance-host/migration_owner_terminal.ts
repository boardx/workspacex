import {createHash} from 'node:crypto';
import {z} from 'zod';
import {assertSourcePlanAuthority,type OriginalPlanAuthority} from './source_plan_authority';
import {bindPublicAcceptance,readPublicReceiptChecks,type PublicAcceptanceBinding,type PublicAcceptanceTransport} from './public_acceptance';
import {readNativeCompletion} from './native_completion';
import {validateHoldRecord} from './a_route_adapter';
import {epochSchema,candidateEnvelopeSchema} from './a_route_factory';
import {runtimeDigest} from './sealed_runtime';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const event=z.object({operation:z.enum(['readPublicIdentity','verifyCanonical','runBrowserSmoke','readObservation']),value:z.unknown()}).strict();
const ref=z.object({path:z.string().startsWith('/etc/workspacex-cn/').refine(p=>!p.split('/').includes('..')),sha256:hash}).strict();
const terminal=z.object({schemaVersion:z.literal(1),kind:z.literal('canonical-migration-owner-evidence-v1'),
 originalPlanSha256:hash,toolRevision:z.string().regex(/^[a-f0-9]{40}$/),holdGeneration:z.string().regex(/^[a-f0-9]{32}$/),
 epoch:ref,completion:ref,candidate:ref,publicReceipts:z.object({canonical:ref,browser:ref}).strict(),holdCas:z.object({input:z.unknown(),cleared:z.unknown(),readback:z.unknown()}).strict(),publicTranscript:z.array(event).min(8).max(124)}).strict();
export const ownerDescriptorSchema=z.object({schemaVersion:z.literal(1),releaseSha256:hash,originalPlanSha256:hash,configSha256:hash}).strict();
export const ownerStartedSchema=z.object({claimSha256:hash,invocationId:z.string().regex(/^[0-9a-f]{32}$/),pid:z.number().int().positive(),startTicks:z.number().int().positive(),bootId:z.string().uuid()}).strict();
export const ownerClaimSchema=z.object({schemaVersion:z.literal(1),kind:z.literal('migration-owner-start-v1'),releaseSha256:hash,planSha256:hash,launcherSha256:hash,unitSha256:hash,unit:z.string()}).strict();
const same=(a:unknown,b:unknown)=>runtimeDigest(a)===runtimeDigest(b);
const need=(ok:unknown,code:string):void=>{if(!ok)throw Error(code);};
const sha=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');

/** Source-only recorder. JSON cannot supply implementations or mark a call done.
 * Each event is appended only after the actual fixed transport resolves. */
export function recordPublicTransport(transport:PublicAcceptanceTransport){
 const events:Array<z.infer<typeof event>>=[];
 const wrapped={} as PublicAcceptanceTransport;
 for(const operation of ['readPublicIdentity','verifyCanonical','runBrowserSmoke','readObservation'] as const){
  const call=transport[operation].bind(transport);
  wrapped[operation]=async()=>{const value=await call();events.push({operation,value:structuredClone(value)});return value;};
 }
 return {transport:wrapped,snapshot:()=>structuredClone(events)};
}

/** Independent raw SHA and binding policy must come from protected owner inputs,
 * never the terminal document. Reuses the original public and native validators.
 * This is evidence verification only; no DDL, writer or unit operation exists. */
export async function verifyOwnerTerminal(authority:OriginalPlanAuthority,raw:Buffer,expectedRawSha256:string,
 binding:PublicAcceptanceBinding,expectedRelease:string,readPinned:(path:string,sha256:string)=>Buffer,now=Date.now()){
 assertSourcePlanAuthority(authority,authority.identity,authority.toolRevision);
 need(sha(raw)===expectedRawSha256,'OWNER_TERMINAL_RAW_PIN');
 const value=terminal.parse(JSON.parse(raw.toString('utf8'))),id=authority.identity;
 need(value.originalPlanSha256===authority.sourcePlanSha256&&value.toolRevision===authority.toolRevision&&same(binding.identity,id),'OWNER_TERMINAL_AUTHORITY');
 const root=`/etc/workspacex-cn/maintenance-evidence/${id.sourceRevision}/${id.attemptId}/qualified-current-epoch/epoch.json`;
 need(value.epoch.path===root&&value.completion.path===`/etc/workspacex-cn/migration-completion-inputs/${id.sourceRevision}/${id.attemptId}.completed.json`&&value.candidate.path===`/etc/workspacex-cn/maintenance-candidate/${id.sourceRevision}/${id.attemptId}/candidate-plan.json`,'OWNER_TERMINAL_PATH');
 for(const lane of ['canonical','browser'] as const)need(value.publicReceipts[lane].path===`/etc/workspacex-cn/maintenance-acceptance/${id.sourceRevision}/${id.attemptId}/${lane}.json`,'OWNER_TERMINAL_PUBLIC_RECEIPT_PATH');
 const originals=[value.epoch,value.completion,value.candidate,value.publicReceipts.canonical,value.publicReceipts.browser].map(r=>({ref:r,raw:readPinned(r.path,r.sha256)}));
 for(const original of originals)need(sha(original.raw)===original.ref.sha256,'OWNER_TERMINAL_EVIDENCE_PIN');
 const originalEpoch=JSON.parse(originals[0]!.raw.toString('utf8'));
 need(originalEpoch.kind==='held-current-epoch-manifest','OWNER_TERMINAL_EPOCH_KIND');
 const epoch=epochSchema.parse({...originalEpoch,kind:'held-current-epoch-evidence',epoch:value.epoch});
 need(same(epoch.identity,id)&&epoch.toolRevision===authority.toolRevision&&epoch.holdGeneration===value.holdGeneration,'OWNER_TERMINAL_EPOCH');
 readNativeCompletion(JSON.parse(originals[1]!.raw.toString('utf8')),id,now,expectedRelease);
 const candidate=candidateEnvelopeSchema.parse(JSON.parse(originals[2]!.raw.toString('utf8')));
 need(candidate.toolRevision===authority.toolRevision&&same(candidate.plan?.identity,id)&&candidate.plan?.holdGeneration===value.holdGeneration&&candidate.plan?.epoch===value.epoch.sha256&&candidate.plan?.migrationCompletionSha256===value.completion.sha256&&candidate.artifact?.sha256===candidate.plan?.artifactSha256,'OWNER_TERMINAL_CANDIDATE');
 const held=validateHoldRecord(value.holdCas.input,id,'held'),cleared=validateHoldRecord(value.holdCas.cleared,id,'cleared'),readback=validateHoldRecord(value.holdCas.readback,id,'cleared');
 need(held.generation===value.holdGeneration&&cleared.generation===held.generation&&same(cleared,readback),'OWNER_TERMINAL_HOLD_CAS');
 const canonicalChecks=readPublicReceiptChecks(JSON.parse(originals[3]!.raw.toString('utf8')),'canonical',binding);
 const browserChecks=readPublicReceiptChecks(JSON.parse(originals[4]!.raw.toString('utf8')),'browser',binding);
 let cursor=0;
 const next=async(operation:z.infer<typeof event>['operation'])=>{const e=value.publicTranscript[cursor++];need(e?.operation===operation,'OWNER_TERMINAL_TRANSCRIPT_ORDER');if(operation==='verifyCanonical')need(same(e!.value,canonicalChecks),'OWNER_TERMINAL_CANONICAL_RECEIPT');if(operation==='runBrowserSmoke')need(same(e!.value,browserChecks),'OWNER_TERMINAL_BROWSER_RECEIPT');return e!.value;};
 const acceptance=bindPublicAcceptance(binding,{readPublicIdentity:()=>next('readPublicIdentity'),verifyCanonical:()=>next('verifyCanonical'),runBrowserSmoke:()=>next('runBrowserSmoke'),readObservation:()=>next('readObservation')});
 await acceptance.verifyPublicAcceptance(id);
 await acceptance.observeOpenedCandidate(id);
 need(cursor===value.publicTranscript.length,'OWNER_TERMINAL_TRANSCRIPT_TRAILING');
 for(const original of originals)need(readPinned(original.ref.path,original.ref.sha256).equals(original.raw),'OWNER_TERMINAL_EVIDENCE_CHANGED');
 assertSourcePlanAuthority(authority,id,authority.toolRevision);
 // Return the validated original evidence, not an independent success flag.
 return Object.freeze({rawSha256:sha(raw),originalPlanSha256:authority.sourcePlanSha256,
  epochSha256:value.epoch.sha256,completionSha256:value.completion.sha256,candidateSha256:value.candidate.sha256,canonicalReceiptSha256:value.publicReceipts.canonical.sha256,browserReceiptSha256:value.publicReceipts.browser.sha256,
  publicTranscriptSha256:runtimeDigest(value.publicTranscript)});
}

/** Live sink uses a pre-existing private owner directory; never creates a new
 * authorization or overwrites ambiguous output. Default source path only. */
export async function admitOwnerTerminalSink(authority:OriginalPlanAuthority,profile:unknown){
 const {constants,openSync,closeSync,writeFileSync,fsyncSync,lstatSync,fstatSync,readFileSync}=await import('node:fs');
 const {protectedPrivateBytes,inheritedFd9Lock}=await import('./fixed_transport');
 need(process.platform==='linux'&&process.getuid?.()===0,'OWNER_TERMINAL_ROOT_LINUX');
 assertSourcePlanAuthority(authority,authority.identity,authority.toolRevision);
 const descriptor=ownerDescriptorSchema.parse((profile as {maintenanceMigrationOwner?:unknown}).maintenanceMigrationOwner);
 need(descriptor.originalPlanSha256===authority.sourcePlanSha256,'OWNER_TERMINAL_DESCRIPTOR');
 const root='/var/lib/workspacex-cn/migration-owner/'+descriptor.releaseSha256;
 const startedRaw=protectedPrivateBytes(root+'/started.json'),claimRaw=protectedPrivateBytes(root+'/claim.json');
 const started=ownerStartedSchema.parse(JSON.parse(startedRaw.toString('utf8')));
 const claim=ownerClaimSchema.parse(JSON.parse(claimRaw.toString('utf8')));
 need(claim.unit===`workspacex-cn-migration@${descriptor.releaseSha256}.service`,'OWNER_TERMINAL_UNIT');
 const currentTicks=Number(readFileSync('/proc/self/stat','utf8').split(') ').at(-1)!.split(' ')[19]);
 need(claim.releaseSha256===descriptor.releaseSha256&&claim.planSha256===authority.sourcePlanSha256&&started.claimSha256===sha(claimRaw)&&started.pid===process.pid&&started.startTicks===currentTicks&&started.bootId===readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),'OWNER_TERMINAL_PROCESS_BINDING');
 await inheritedFd9Lock(); // Assert only; do not invoke the returned release.
 const parent=lstatSync(root);
 need(parent.isDirectory()&&parent.uid===0&&parent.gid===0&&(parent.mode&0o777)===0o700,'OWNER_TERMINAL_DIRECTORY');
 const check=()=>{
  const current=lstatSync(root);need(current.dev===parent.dev&&current.ino===parent.ino,'OWNER_TERMINAL_DIRECTORY_CHANGED');
  need(protectedPrivateBytes(root+'/started.json').equals(startedRaw)&&protectedPrivateBytes(root+'/claim.json').equals(claimRaw),'OWNER_TERMINAL_OWNER_CHANGED');
  assertSourcePlanAuthority(authority,authority.identity,authority.toolRevision);
 };
 const write=(name:string,raw:Buffer)=>{
  check();const fd=openSync(root+'/'+name,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,raw);fsyncSync(fd);const st=fstatSync(fd);need(st.nlink===1&&st.uid===0&&st.gid===0&&(st.mode&0o777)===0o600,'OWNER_TERMINAL_FILE');}finally{closeSync(fd);}
  const dir=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{const st=fstatSync(dir);need(st.dev===parent.dev&&st.ino===parent.ino,'OWNER_TERMINAL_DIRECTORY_CHANGED');fsyncSync(dir);}finally{closeSync(dir);}check();
 };
 return async(raw:Buffer)=>{
  await inheritedFd9Lock();check();need(raw.length<=1048576,'OWNER_TERMINAL_SIZE');
  write('terminal.json',raw);
  need(protectedPrivateBytes(root+'/terminal.json',sha(raw)).equals(raw),'OWNER_TERMINAL_READBACK');
  write('terminal-seal.json',Buffer.from(JSON.stringify({schemaVersion:1,claimSha256:sha(claimRaw),startedSha256:sha(startedRaw),terminalSha256:sha(raw),terminalBytes:raw.length})+'\n'));
 };
}
