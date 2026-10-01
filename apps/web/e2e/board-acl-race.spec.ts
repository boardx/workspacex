import {test,expect} from '@playwright/test';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
const exec=promisify(execFile);
test('comment and checkpoint operations recheck permissions after a real PostgreSQL lock wait',async({request},info)=>{
 const origin=`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`;
 async function login(email:string,password:string){const response=await request.post(`${origin}/auth/login`,{data:{email,password}});expect(response.ok()).toBe(true);const body=await response.json();expect(typeof body.sessionToken).toBe('string');return body.sessionToken as string;}
 const owner=await login(F.adminEmail,F.adminPassword),member=await login(F.leadEmail,F.leadPassword);
 const {stdout}=await exec('node',['--import','tsx','apps/api/tests/whiteboard/support/comment-recovery-acl-race.mjs'],{cwd:resolve(__dirname,'../../..'),env:{...process.env,BOARD_ACL_RACE_ISOLATED:'1',BOARD_ACL_API_URL:origin,BOARD_ACL_OWNER_TOKEN:owner,BOARD_ACL_MEMBER_TOKEN:member,BOARD_ACL_ORG_ID:F.orgId,BOARD_ACL_MEMBER_ID:F.leadUserId},timeout:150000,maxBuffer:1024*1024});
 const result=JSON.parse(stdout);expect(result.evidence).toHaveLength(6);expect(result.evidence.every((row:{lockWaitObserved:boolean;denied:boolean})=>row.lockWaitObserved&&row.denied)).toBe(true);
 await writeFile(info.outputPath('acl-race-evidence.json'),JSON.stringify(result,null,2));
});
