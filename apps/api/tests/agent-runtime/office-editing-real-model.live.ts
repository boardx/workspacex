import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const run=promisify(execFile);
for(const caseId of ['S003_EDIT','S004_EDIT','S005_EDIT'])it(`${caseId} pinned real model edits and publishes a preserved Office artifact`,async()=>{
 const evidence=join(process.env.WX_DOCUMENT_SKILLS_REAL_EVIDENCE!,caseId);await mkdir(evidence,{recursive:true});
 const {stdout,stderr}=await run('pnpm',['exec','vitest','run','--config','vitest.skill-batch-real-model.config.ts'],{cwd:process.cwd(),timeout:420000,maxBuffer:64*1024*1024,env:{...process.env,WX_SKILL_BATCH_CASE:caseId,WX_SKILL_BATCH_EVIDENCE:evidence}});
 expect(stderr).not.toMatch(/failed|error/i);expect(stdout).toMatch(/1 passed/);
},480000);
