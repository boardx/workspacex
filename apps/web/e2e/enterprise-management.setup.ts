import {spawnSync} from "node:child_process";
import {mkdirSync,rmSync,writeFileSync} from "node:fs";
/** On the browser-owned warm DB run only the new retained-history boundary. */
export default async function enterpriseWarmSchema(){
 rmSync("test-results/enterprise-management-6108/browser-success.json",{force:true});
 if(!process.env.WORKSPACEX_ISOLATION_ID||!process.env.PGDATABASE?.startsWith("wsx_"))throw Error("owned warm database required");
 const result=spawnSync("pnpm",["--filter","@repo/api","exec","vitest","run","--config","vitest.enterprise-retention-pg.config.ts"],{cwd:process.cwd(),env:process.env,encoding:"utf8",maxBuffer:16*1024*1024,timeout:300000});
 mkdirSync("test-results/enterprise-management-6108",{recursive:true});writeFileSync("test-results/enterprise-management-6108/retention-pg.txt",`${result.stdout??""}${result.stderr??""}`);
 process.stdout.write(result.stdout??"");process.stderr.write(result.stderr??"");
 if(result.error)throw result.error;if(result.status!==0)throw Error(`warm schema/default cleanup verification failed: ${result.status}`);
}
