import base from '/Users/shenyangjun/.codex/worktrees/548a/workspacex/apps/web/playwright.fullstack-smoke.config';
const root='/Users/shenyangjun/.codex/worktrees/548a/workspacex';
const out='/Users/shenyangjun/.codex/worktrees/548a/workspacex/evidence/e2e-two-round-20261030/round-2';
const servers=(Array.isArray(base.webServer)?base.webServer:[base.webServer]).filter(Boolean).map(s=>({...s,cwd:root+'/apps/web'}));
const launchOptions={...base.use?.launchOptions,args:[...(base.use?.launchOptions?.args??[]).filter(a=>a!=='--force-device-scale-factor=1'),'--force-device-scale-factor=1']};
const projects=(base.projects??[]).filter(p=>p.name?.startsWith('core-loop-'));
export default {...base,testDir:root+'/apps/web/e2e',workers:1,fullyParallel:false,outputDir:out+'/core-browser',reporter:[['list'],['json',{outputFile:out+'/core-results.json'}]],use:{...base.use,headless:true,launchOptions,trace:'retain-on-failure',screenshot:'only-on-failure'},projects:projects?.map(p=>({...p,...(false?{dependencies:[]}:{}),workers:1,fullyParallel:false,use:{...p.use,headless:true,launchOptions}})),webServer:servers};
