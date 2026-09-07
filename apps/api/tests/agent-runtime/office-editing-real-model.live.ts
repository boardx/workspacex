import { execFile } from 'node:child_process';
import { mkdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const run=promisify(execFile);
for(const caseId of ['S003_EDIT','S004_EDIT','S005_EDIT'])it(`${caseId} pinned real model edits and publishes a preserved Office artifact`,async()=>{
 const evidence=join(process.env.WX_DOCUMENT_SKILLS_REAL_EVIDENCE!,caseId);await mkdir(evidence,{recursive:true});
 await run('pnpm',['exec','vitest','run','--config','vitest.skill-batch-real-model.config.ts'],{cwd:process.cwd(),timeout:420000,maxBuffer:64*1024*1024,env:{...process.env,WX_SKILL_BATCH_CASE:caseId,WX_SKILL_BATCH_EVIDENCE:evidence}});
 const result=JSON.parse(await readFile(join(evidence,'result.json'),'utf8')) as {caseId:string;outputSha256:string;artifactDownloadSha256:string;selectedPin:{stableName:string;versionId:string;packageDigest:string};assertions:Record<string,boolean>};expect(result.caseId).toBe(caseId);expect(result.outputSha256).toMatch(/^[a-f0-9]{64}$/);expect(result.artifactDownloadSha256).toBe(result.outputSha256);expect(result.selectedPin.versionId).toBeTruthy();expect(result.selectedPin.packageDigest).toMatch(/^[a-f0-9]{64}$/);expect(Object.keys(result.assertions).sort()).toEqual(['artifactHashPreserved','freshSandboxReopen','oldPinUnchanged','pageCountVerified','pinUsed','rendererBoundToEditedSource','reviewableScreenshots','targetChanged','unrelatedEntriesPreserved'].sort());expect(Object.values(result.assertions).every(Boolean)).toBe(true);
 const [target,unrelated,reopen,visual]=await Promise.all(['target-diff.json','unrelated-entry-hashes.json','fresh-sandbox-reopen.json','visual-review.json'].map(name=>readFile(join(evidence,name),'utf8').then(JSON.parse)));expect(target).toBeTruthy();expect(unrelated.length).toBeGreaterThan(0);expect(reopen.exactBytes).toBe(true);expect(reopen.reopenedSha256).toBe(result.outputSha256);expect(visual.source.sha256).toBe(result.outputSha256);expect(visual.screenshots).toHaveLength(visual.expectedPageCount);expect(visual.pdf.pageCount).toBe(visual.expectedPageCount);
},480000);
