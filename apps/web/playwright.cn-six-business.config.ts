/** Real Next dev/Nest/PG; deterministic external provider protocols, not production acceptance. */
import {defineConfig} from '@playwright/test';
import base from './playwright.chat-read.config';
import {admitOutputs} from '../../tests/fixtures/cn-six-business/output-admission';
const reportPath=process.env.CN_SIX_REPORT_PATH,outputPath=process.env.CN_SIX_OUTPUT_DIR;
if(Boolean(reportPath)!==Boolean(outputPath))throw Error('PAIRED_PRIVATE_OUTPUTS_REQUIRED');
if(reportPath&&outputPath)admitOutputs(reportPath,outputPath,process.env.TEST_WORKER_INDEX);
if(process.env.CN_RELEASE_FULLSTACK_FIXTURE!=='1'||process.env.WORKSPACEX_REUSE_INFRA==='1'||!process.env.CN_SIX_INFRA_RECEIPT)throw Error('EXPLICIT_FRESH_SIX_JOURNEY_FIXTURE_REQUIRED');
const infraReceipt=process.env.CN_SIX_INFRA_RECEIPT;
const servers=Array.isArray(base.webServer)?base.webServer:[];
let replaced=0,nextReplaced=0;
const webServer=servers.map(server=>{
 if(server.command.includes('NEXT_DIST_DIR=.next-chat-read-e2e next dev -p ')){
  nextReplaced++;
  // The isolated launcher invokes Playwright directly, outside a pnpm script.
  // Resolve Next from the web workspace explicitly instead of inherited .bin PATH.
  return {...server,command:server.command.replace('NEXT_DIST_DIR=.next-chat-read-e2e next dev -p ','NEXT_DIST_DIR=.next-chat-read-e2e pnpm --filter web exec next dev -p ')};
 }
 if(!server.command.includes('pnpm --filter @repo/api start 2>&1'))return server;
 replaced++;
 const parts=server.command.split(' && ');
 if(parts.length!==6||!parts[0]!.includes('up -d --wait postgres redis')||!parts[1]!.includes('createdb')||parts[2]!=='pnpm --filter @repo/api migrate'||parts[3]!=='pnpm --filter @repo/api exec tsx scripts/seed-chat-read-e2e.ts')throw Error('EXACT_INFRA_STARTUP_SHAPE_REQUIRED');
 const command=['pnpm --filter @repo/api exec tsx ../../tests/fixtures/cn-six-business/infra-preflight.ts',...parts.slice(2)].join(' && ').replace('pnpm --filter @repo/api start 2>&1','pnpm --filter @repo/api exec tsx ../../tests/fixtures/cn-six-business/start-api.ts 2>&1');
 return {...server,command,env:{...server.env,CN_RELEASE_FULLSTACK_FIXTURE:'1',CN_SIX_INFRA_RECEIPT:infraReceipt}};
});
if(replaced!==1)throw Error('EXACT_API_STARTUP_SHAPE_REQUIRED');
if(nextReplaced!==1)throw Error('EXACT_NEXT_STARTUP_SHAPE_REQUIRED');
export default defineConfig({...base,workers:1,retries:0,forbidOnly:true,
 projects:[{name:'cn-six-business',testMatch:'cn-release-six-business.spec.ts'}],
 webServer,reporter:[['line'],['json',{outputFile:reportPath??'test-results/cn-six-business.json'}]],
 outputDir:outputPath??'test-results/cn-six-business',globalTimeout:1200000});
