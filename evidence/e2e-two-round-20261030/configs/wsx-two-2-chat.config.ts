import base from '/Users/shenyangjun/.codex/worktrees/548a/workspacex/apps/web/playwright.chat-read.config';
const root='/Users/shenyangjun/.codex/worktrees/548a/workspacex';
const out='/Users/shenyangjun/.codex/worktrees/548a/workspacex/evidence/e2e-two-round-20261030/round-2';
const servers=(Array.isArray(base.webServer)?base.webServer:[base.webServer]).filter(Boolean).map(s=>({...s,cwd:root+'/apps/web'}));
const launchOptions={...base.use?.launchOptions,args:[...(base.use?.launchOptions?.args??[]).filter(a=>a!=='--force-device-scale-factor=1'),'--force-device-scale-factor=1']};
const projects=base.projects;
const preparedServers=servers.map((server,index)=>{
 if(index!==servers.length-1)return server;
 return {...server,command:server.command.replace('NEXT_DIST_DIR=.next-chat-read-e2e next dev', 'WORKSPACEX_RELEASE_BUILD=1 NEXT_DIST_DIR=.next-chat-two-prod sh -c \'next build && next start').replace(/ -p (\d+)$/, ' -p $1\''),timeout:600000,stdout:'pipe'};
});
export default {...base,globalSetup:root+'/apps/web/e2e/chat-route-warmup.global-setup.ts',testDir:root+'/apps/web/e2e',workers:1,fullyParallel:false,outputDir:out+'/chat-browser',reporter:[['list'],['json',{outputFile:out+'/chat-results.json'}]],use:{...base.use,headless:true,launchOptions,trace:'retain-on-failure',screenshot:'only-on-failure'},projects:projects?.map(p=>({...p,...(true?{dependencies:[]}:{}),workers:1,fullyParallel:false,use:{...p.use,headless:true,launchOptions}})),webServer:preparedServers};
