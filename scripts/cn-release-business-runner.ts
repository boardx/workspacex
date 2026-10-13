/** Live business execution only; CLI admission stays closed until a reviewed
 * live-state / scoped-writer adapter exists. No caller supplied passed flags. */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { cnReleaseBrowserSchema } from '../packages/cloud-deploy/src/cn-release-browser-contract';
import { assertJourneyBoundary, maintenanceJourneyEffects, type AcceptanceBoundary } from '../packages/cloud-deploy/src/cn-maintenance-host/acceptance_contract';
const require = createRequire(import.meta.url);
const browser = require('../.harness/scripts/vm/cn-maintenance-browser.cjs');
const fields = ['sourceRevision','baselineRevision','controlRevision','publicationAttemptId','attemptId','requestedAt','deadlineAt'] as const;
export type Identity = Record<(typeof fields)[number], string>;
export interface WriterResumeApproval {
  kind: 'cn-writer-resume-approval-v1'; identity: Identity;
  releaseSha256: string; target: {accountId: string; region: string; ecsInstanceId: string};
  heldHealthSha256: string; holdRawSha256: string; userAuthorizationEvidenceSha256: string;
  bindingSha256: string; switchReceiptSha256: string; holdGeneration: string;
  testDataScopeSha256: string; issuedAt: string; expiresAt: string;
  publicOrigin: 'https://app.boardx.com.cn/';
  scope: 'a5-resume-writers-and-a6-scoped-business-observation';
}
export interface LiveState {
  identity: Identity; boundary: AcceptanceBoundary; runtimeRevision: string; runtimeInventorySha256: string;
  deploymentMarker: string; bindingSha256: string; switchReceiptSha256: string;
  holdGeneration: string; observedAt: string; clearReceiptSha256: string | null;
  /** An actual independent runtime/hold readback, never a request flag. */
  runtimeHealthy: boolean; writerResumeApprovalSha256: string | null; testDataScopeSha256: string;
}
export interface Execution {
  mode: 'acceptance'|'observe'|'rollback'; identity: Identity; releaseSha256: string;
  publicOrigin: string; plan: Record<string, unknown>;
  bindingSha256: string; switchReceiptSha256: string; holdGeneration: string;
  rollbackApproval?: { baselineRevision: string; issuedAt: string; expiresAt: string; approvalSha256: string };
  stableWindowSeconds: number; writerResumeApproval?: {approvalSha256: string; raw: string};
}
export interface Dependencies {
  chromium: any;
  captureSession?: (token:string)=>Promise<void>;
  /** Must be fixed/pinned privileged adapter. Never deserialize state from stdin. */
  readLiveState: () => Promise<LiveState>;
  now?: () => number;
  monotonic?: () => number;
  wait?: (ms: number) => Promise<void>;
}
function need(ok: unknown, code: string): asserts ok { if (!ok) throw Error(code); }
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function utc(v: string): number { need(typeof v==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(v),'UTC_REQUIRED'); const n=Date.parse(v);need(Number.isFinite(n),'UTC_REQUIRED');return n; }
function sha(v: unknown) { need(typeof v==='string' && /^[a-f0-9]{64}$/.test(v),'HASH_REQUIRED'); }
function validateIdentity(i: Identity) {
  need(Object.keys(i).sort().join('|')===[...fields].sort().join('|'),'IDENTITY_FIELDS');
  for(const k of ['sourceRevision','baselineRevision','controlRevision'] as const)need(/^[a-f0-9]{40}$/.test(i[k]),'IDENTITY_REVISION');
  for(const k of ['attemptId','publicationAttemptId'] as const)need(/^[a-z0-9-]{1,64}$/.test(i[k]),'IDENTITY_ATTEMPT');
  const span=utc(i.deadlineAt)-utc(i.requestedAt);need(span>0 && span<=1800000,'ORIGINAL_RELEASE_WINDOW');
}
export function validateLiveState(r: Execution,s: LiveState,now: number, authorizationAt=now) {
  validateIdentity(r.identity);need(fields.every(k=>s.identity[k]===r.identity[k]),'LIVE_IDENTITY');
  for(const k of ['bindingSha256','switchReceiptSha256'] as const){sha(r[k]);need(s[k]===r[k],'LIVE_BINDING');}
  need(typeof r.holdGeneration==='string'&&/^[a-f0-9]{32}$/.test(r.holdGeneration)&&s.holdGeneration===r.holdGeneration,'LIVE_HOLD_GENERATION');
  need(s.runtimeHealthy===true,'LIVE_RUNTIME_HEALTH');sha(s.runtimeInventorySha256);
  need(s.runtimeRevision===(r.mode==='rollback'?r.identity.baselineRevision:r.identity.sourceRevision),'LIVE_RUNTIME_REVISION');
  need(s.deploymentMarker===r.plan.deploymentMarker,'LIVE_PUBLIC_MARKER');
  need(now>=utc(s.observedAt)&&now-utc(s.observedAt)<=30000,'LIVE_STATE_STALE');
  need(['isolated-candidate','production-held-readback','production-public'].includes(s.boundary.phase),'BOUNDARY_PHASE');
  for(const k of ['lockRetained','writesHeld','testDataScopeApproved','publicResumeAuthorized'] as const)need(typeof s.boundary[k]==='boolean','BOUNDARY_BOOLEAN');
  for(const journey of Object.keys(maintenanceJourneyEffects) as (keyof typeof maintenanceJourneyEffects)[])assertJourneyBoundary(journey,s.boundary);
  if(s.boundary.phase==='production-public'){
    sha(s.clearReceiptSha256);need(r.publicOrigin==='https://app.boardx.com.cn/','CN_PRODUCTION_ORIGIN');
    const envelope=r.writerResumeApproval;need(envelope,'A5_SEPARATE_APPROVAL_REQUIRED');need(typeof envelope.raw==='string'&&Buffer.byteLength(envelope.raw)<=16384,'A5_RAW_BOUND');sha(envelope.approvalSha256);need(createHash('sha256').update(envelope.raw).digest('hex')===envelope.approvalSha256,'A5_RAW_HASH');
    const a=JSON.parse(envelope.raw);
    need(JSON.stringify(a)===envelope.raw.trim(),'A5_CANONICAL_RAW');
    const approvalFields=['kind','scope','releaseSha256','identity','target','issuedAt','expiresAt','bindingSha256',r.mode==='rollback'?'runtimeRecoveryReceiptSha256':'switchReceiptSha256','heldHealthSha256','holdRawSha256','holdGeneration','userAuthorizationEvidenceSha256','testDataScopeSha256','publicOrigin'];if(r.mode==='rollback')approvalFields.push('recoveryApprovalSha256');
    need(Object.keys(a).sort().join('|')===approvalFields.sort().join('|'),'A5_EXACT_FIELDS');
    need(r.mode==='rollback'?a.kind==='cn-recovery-writer-resume-approval-v1'&&a.scope==='resume-baseline-writers-and-scoped-business-observation':a.kind==='cn-writer-resume-approval-v1'&&a.scope==='a5-resume-writers-and-a6-scoped-business-observation','A5_SEPARATE_APPROVAL_REQUIRED');
    if(r.mode==='rollback')need(a.recoveryApprovalSha256===r.rollbackApproval?.approvalSha256&&utc(a.issuedAt)>=utc(r.rollbackApproval!.issuedAt)&&utc(a.expiresAt)<=utc(r.rollbackApproval!.expiresAt),'RECOVERY_WRITER_WINDOW');
    validateIdentity(a.identity);need(fields.every(k=>a.identity[k]===r.identity[k]),'A5_IDENTITY');
    need(a.publicOrigin===r.publicOrigin&&a.bindingSha256===r.bindingSha256&&a[r.mode==='rollback'?'runtimeRecoveryReceiptSha256':'switchReceiptSha256']===r.switchReceiptSha256&&a.holdGeneration===r.holdGeneration,'A5_BINDING');
    for(const key of ['releaseSha256','heldHealthSha256','holdRawSha256','userAuthorizationEvidenceSha256','testDataScopeSha256'] as const)sha(a[key]);
    need(Object.keys(a.target).sort().join('|')==='accountId|ecsInstanceId|region'&&a.target.accountId==='1177216024653153'&&a.target.region==='cn-shanghai'&&a.target.ecsInstanceId==='i-uf6ga92ewloganobbln6','A5_TARGET');
    sha(r.releaseSha256);need(a.releaseSha256===r.releaseSha256,'A5_RELEASE');
    need(s.writerResumeApprovalSha256===envelope.approvalSha256&&s.testDataScopeSha256===a.testDataScopeSha256,'A5_ACTUAL_CLEAR_LINK');
    need(utc(a.issuedAt)<=authorizationAt&&authorizationAt<utc(a.expiresAt)&&utc(a.expiresAt)-utc(a.issuedAt)<=1800000,'A5_FRESH_AUTHORIZATION');
    if(r.mode!=='rollback')need(utc(a.issuedAt)>=utc(r.identity.requestedAt)&&utc(a.expiresAt)<=utc(r.identity.deadlineAt),'A5_ORIGINAL_WINDOW');
  }
  else {need(r.writerResumeApproval===undefined&&s.writerResumeApprovalSha256===null,'ISOLATED_CANNOT_RESUME');need(s.clearReceiptSha256===null,'ISOLATED_CLEAR_FORBIDDEN');need(!['app.boardx.com.cn','www.boardx.com.cn','app2.boardx.com.cn','www.boardx.us','app.boardx.us'].includes(new URL(r.publicOrigin).hostname),'ISOLATED_ORIGIN_REQUIRED');}
  if(r.mode==='observe')need(s.boundary.phase==='production-public','OBSERVE_PUBLIC_REQUIRED');
}
/** Real runner performs login, SSE completion + persisted runs, ASR audio,
 * GitHub issue read, skill/tool trace and real PDF magic verification. */
export async function executeBusiness(r: Execution,d: Dependencies) {
  validateIdentity(r.identity);need(['acceptance','observe','rollback'].includes(r.mode),'MODE');
  const now=d.now??Date.now, monotonic=d.monotonic??(()=>performance.now()), wait=d.wait??(ms=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
  const started=now(), mono=monotonic();let deadline=utc(r.identity.deadlineAt);
  need(started>=utc(r.identity.requestedAt),'RELEASE_NOT_STARTED');
  if(r.mode==='rollback'){
    const a=r.rollbackApproval;need(a&&a.baselineRevision===r.identity.baselineRevision,'ROLLBACK_APPROVAL');sha(a.approvalSha256);
    need(utc(a.issuedAt)<=started&&started<utc(a.expiresAt)&&utc(a.expiresAt)-utc(a.issuedAt)<=1800000,'ROLLBACK_FRESH_WINDOW');
    deadline=utc(a.expiresAt); // Separate explicit recovery clock; original fields remain unchanged.
  }else need(r.rollbackApproval===undefined,'UNEXPECTED_ROLLBACK_APPROVAL');
  const tick=()=>need(now()<deadline && monotonic()-mono<deadline-started,'BUSINESS_DEADLINE');tick();
  need(Number.isSafeInteger(r.stableWindowSeconds)&&r.stableWindowSeconds>=0&&r.stableWindowSeconds<=300,'STABLE_WINDOW');
  need(r.mode==='observe'?r.stableWindowSeconds>=30:r.stableWindowSeconds===0,'MODE_STABLE_WINDOW');
  browser.validatePlan(r.plan);need(r.plan.publicUrl===r.publicOrigin,'ORIGIN_BINDING');
  const before=await d.readLiveState();tick();validateLiveState(r,before,now());
  const runIds:string[]=[];let sessionCaptured=false;
  // Wrap observations, never replace canonical browser actions or results.
  const chromium={launch:async(options:unknown)=>{
    const real=await d.chromium.launch(options);return new Proxy(real,{get(target,key){
      if(key!=='newContext'){const value=target[key];return typeof value==='function'?value.bind(target):value;}
      return async(options:unknown)=>{const context=await target.newContext(options);return new Proxy(context,{get(ctx,key){
        if(key!=='newPage'){const value=ctx[key];return typeof value==='function'?value.bind(ctx):value;}
        return async()=>{const page=await ctx.newPage();return new Proxy(page,{get(p,key){
          if(key==='waitForResponse')return async(...args:any[])=>{const response=await p.waitForResponse(...args);return new Proxy(response,{get(res,key){
            if(key==='text')return async()=>{const raw=await res.text();runIds.push(browser.finishedRun(raw));return raw;};
            const value=res[key];return typeof value==='function'?value.bind(res):value;
          }});};
          if(key==='evaluate')return async(...args:any[])=>{const result=await p.evaluate(...args);
            if(d.captureSession&&!sessionCaptured&&typeof args[1]==='string'&&args[1].startsWith('/api/agent-runs/')){
              const token=await p.evaluate(()=>localStorage.getItem('wsx.sessionToken'));
              need(typeof token==='string'&&token.length>0&&Buffer.byteLength(token)<=16384,'PRIVATE_SESSION_REQUIRED');
              await d.captureSession(token);sessionCaptured=true;
            }return result;};
          const value=p[key];return typeof value==='function'?value.bind(p):value;
        }});};
      }});};
    }});
  }};
  const checks=cnReleaseBrowserSchema.parse(await browser.run(r.plan,chromium));tick();
  need(runIds.length===3&&new Set(runIds).size===3,'OWNED_RUN_SET');
  const invariant=(s:LiveState)=>({identity:s.identity,boundary:s.boundary,runtimeRevision:s.runtimeRevision,runtimeInventorySha256:s.runtimeInventorySha256,deploymentMarker:s.deploymentMarker,bindingSha256:s.bindingSha256,switchReceiptSha256:s.switchReceiptSha256,holdGeneration:s.holdGeneration,clearReceiptSha256:s.clearReceiptSha256,writerResumeApprovalSha256:s.writerResumeApprovalSha256,testDataScopeSha256:s.testDataScopeSha256});
  const observations=[digest(before)];
  const stableStart=monotonic();
  do {
    if(r.mode==='observe')await wait(Math.min(5000,Math.max(1,r.stableWindowSeconds*1000-(monotonic()-stableStart))));
    tick();const current=await d.readLiveState();tick();validateLiveState(r,current,now());
    need(digest(invariant(current))===digest(invariant(before)),'LIVE_STATE_CHANGED');observations.push(digest(current));
  }while(monotonic()-stableStart<r.stableWindowSeconds*1000);
  tick();return {schemaVersion:1,kind:before.boundary.phase==='isolated-candidate'?'cn-isolated-business-acceptance-v1':'cn-independent-business-acceptance-v1',
    ...r.identity,mode:r.mode,runtimeRevision:before.runtimeRevision,runtimeInventorySha256:before.runtimeInventorySha256,bindingSha256:r.bindingSha256,switchReceiptSha256:r.switchReceiptSha256,holdGeneration:r.holdGeneration,
    observedAt:new Date(now()).toISOString(),checks,ownedAcceptanceRunIds:runIds,liveObservationSha256:observations,
    ...(r.mode==='rollback'?{recoveryApprovalSha256:r.rollbackApproval!.approvalSha256,runtimeRecoveryReceiptSha256:r.switchReceiptSha256}:{}),
    stableWindowSeconds:r.stableWindowSeconds,externalWritesTerminal:false};
}
