/** Actual selected-suite reports. A skipped job never substitutes for these records. */
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {validateReport} from './ci-web-shards.mjs';
import {identities,assertCoverage,verifyResults,reportHash} from './ci-chat-shards.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function bind(plan,evidence,context,suite){
 if(plan?.schemaVersion!==1||plan?.mode!=='targeted-ui'||!['planDigest','policyDigest'].every(k=>/^[a-f0-9]{64}$/.test(plan[k]??''))||evidence?.schemaVersion!==1||!context||!/^[a-f0-9]{40}$/.test(context.sha??'')||!['run','attempt'].every(k=>/^[1-9]\d*$/.test(context[k]??''))||context.sha!==plan.headSha)throw Error('INVALID_TARGETED_IDENTITY');
 if(evidence.suite!==suite||Object.keys(context).some(k=>evidence[k]!==context[k])||evidence.planDigest!==plan.planDigest||evidence.policyDigest!==plan.policyDigest)throw Error('TARGETED_EVIDENCE_IDENTITY_MISMATCH');
}
function base(plan,context,suite){return {schemaVersion:1,suite,...context,planDigest:plan.planDigest,policyDigest:plan.policyDigest}}
export function unitEvidence(plan,report,cwd,context){
 const evidence={...base(plan,context,'web-unit'),cwd,report,reportHash:hash(report)};
 verifyUnitEvidence(plan,evidence,context);return evidence;
}
export function verifyUnitEvidence(plan,evidence,context){
 bind(plan,evidence,context,'web-unit');
 if(evidence.reportHash!==hash(evidence.report))throw Error('CHANGED_UNIT_REPORT');
 const files=plan.suites.find(x=>x.id==='web-unit')?.files;
 if(!files?.length)throw Error('MISSING_UNIT_SELECTION');
 validateReport(evidence.report,files.map(x=>({file:x.file,projectName:''})),evidence.cwd);return true;
}
function selectedFiles(report,cwd){
 if(typeof report.config?.rootDir!=='string')throw Error('MISSING_BROWSER_ROOT');
 const files=new Set();const walk=suites=>{for(const suite of suites??[]){for(const spec of suite.specs??[])files.add(resolve(report.config.rootDir,spec.file));walk(suite.suites)}};walk(report.suites);
 return [...files].sort();
}
function requireBrowserFiles(plan,report,cwd){
 const files=plan.suites.find(x=>x.id==='chat-ui')?.files;
 if(!files?.length||JSON.stringify(selectedFiles(report,cwd))!==JSON.stringify(files.map(x=>resolve(cwd,x.file)).sort()))throw Error('BROWSER_SELECTION_MISMATCH');
}
export function browserEvidence(plan,discovery,report,cwd,context,status){
 requireBrowserFiles(plan,discovery,cwd);const full=identities(discovery);
 const coverage={...assertCoverage(full,[full]),full,partitions:[full],discoverySha256:createHash('sha256').update([...full].sort().join('\n')).digest('hex')};
 const evidence={...base(plan,context,'chat-ui'),cwd,discovery,coverage,status,report,reportHash:reportHash(report)};
 verifyBrowserEvidence(plan,evidence,context);return evidence;
}
export function verifyBrowserEvidence(plan,evidence,context){
 bind(plan,evidence,context,'chat-ui');
 requireBrowserFiles(plan,evidence.discovery,evidence.cwd);requireBrowserFiles(plan,evidence.report,evidence.cwd);
 if(JSON.stringify(identities(evidence.discovery))!==JSON.stringify(evidence.coverage.full)||!evidence.report.stats?.expected)throw Error('EMPTY_OR_CHANGED_BROWSER_DISCOVERY');
 const result={shard:1,status:evidence.status,report:evidence.report,reportHash:evidence.reportHash,discoverySha256:evidence.coverage.discoverySha256,sha:evidence.sha,runId:evidence.run,attempt:evidence.attempt,stats:evidence.report.stats,identities:identities(evidence.report)};
 return verifyResults([result],evidence.coverage,{sha:context.sha,runId:context.run,attempt:context.attempt});
}
export function verifyEvidence(plan,evidence,context){
 if(!Array.isArray(evidence)||evidence.length!==2||new Set(evidence.map(x=>x.suite)).size!==2)throw Error('INCOMPLETE_TARGETED_SUITES');
 verifyUnitEvidence(plan,evidence.find(x=>x.suite==='web-unit'),context);
 verifyBrowserEvidence(plan,evidence.find(x=>x.suite==='chat-ui'),context);return true;
}
