import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
const {claimDist}=createRequire(import.meta.url)('../e2e/support/chat-refresh-owned-process.cjs');
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
async function configuration(diag='0',prod='0',id='unit-config-only'){
 vi.resetModules();vi.stubEnv('WSX_CHAT_REFRESH_DIAGNOSTICS',diag);vi.stubEnv('WSX_CHAT_REFRESH_PRODUCTION_WEB',prod);vi.stubEnv('WORKSPACEX_ISOLATION_ID',id);
 for(const [i,name] of ['API','WEB','MODEL_PROVIDER','DEEP_AGENT_PROVIDER','LOOPBACK_SANDBOX','ASR_PROVIDER','VISION_PROVIDER'].entries())vi.stubEnv(`WORKSPACEX_${name}_PORT`,String(24000+i));
 return (await import('../playwright.chat-read.config')).default;
}
const servers=(config:Awaited<ReturnType<typeof configuration>>)=>Array.isArray(config.webServer)?config.webServer:[];
it('flag-off preserves the original dev command and 120s startup budget',async()=>{
 const config=await configuration(),web=servers(config).find(s=>s.command.includes('NEXT_DIST_DIR=.next-chat-read-e2e'))!;
 expect(web.command).toContain('NEXT_DIST_DIR=.next-chat-read-e2e next dev -p 24001');expect(web.timeout).toBe(120000);expect(web.gracefulShutdown).toBeUndefined();const api=servers(config).find(s=>s.url==='http://127.0.0.1:24000/healthz')!;expect(api.command).not.toContain('chat-refresh-diagnostic-server.mjs api');expect(api.gracefulShutdown).toBeUndefined();
});
it('production assets do not enable request diagnostics implicitly',async()=>{const c=await configuration('0','1');expect(servers(c).at(-1)?.command).toContain('next next start');expect(servers(c).at(-1)?.env?.WSX_CHAT_REFRESH_DIAGNOSTICS).toBe('0');expect(servers(c).at(-1)?.gracefulShutdown).toEqual({signal:'SIGTERM',timeout:5000});const api=servers(c).find(s=>s.url==='http://127.0.0.1:24000/healthz')!;expect(api.command).toContain('chat-refresh-diagnostic-server.mjs api');expect(api.gracefulShutdown).toEqual({signal:'SIGTERM',timeout:5000});expect(api.env?.WSX_CHAT_REFRESH_DIAGNOSTICS).toBe('0');});
it('binds build/start env to one isolation, keeps API/agent routes and all scenario budgets',async()=>{
 const original=await configuration('1','0'),production=await configuration('1','1');
 const web=servers(production).find(s=>s.command.includes('next next start'))!,api=servers(production).find(s=>s.url==='http://127.0.0.1:24000/healthz')!;
 expect(web.env?.NEXT_DIST_DIR).toMatch(/^\.next-chat-refresh-[a-f0-9]{16}$/);expect(web.env?.NEXT_PUBLIC_API_URL).toBe('http://127.0.0.1:24001');expect(web.env?.CHAT_READ_E2E_API_ORIGIN).toBe('http://127.0.0.1:24000');expect(web.env?.COPILOTKIT_V2_AGENT_ID).toBeTruthy();
 expect(web.env?.NODE_ENV).toBe('production');expect(web.env?.WORKSPACEX_RELEASE_BUILD).toBe('0');expect(web.timeout).toBe(120000);expect(web.gracefulShutdown).toEqual({signal:'SIGTERM',timeout:5000});expect(api.gracefulShutdown).toEqual(web.gracefulShutdown);
 expect(api.command).toBe(servers(original).find(s=>s.url===api.url)!.command);expect(production.timeout).toBe(original.timeout);expect(production.expect).toEqual(original.expect);expect(production.projects?.map(p=>p.name)).toEqual(original.projects?.map(p=>p.name));
 const again=await configuration('1','1'),other=await configuration('1','1','different-isolation');
 expect(servers(again).at(-1)?.env?.NEXT_DIST_DIR).toBe(web.env?.NEXT_DIST_DIR);expect(servers(other).at(-1)?.env?.NEXT_DIST_DIR).not.toBe(web.env?.NEXT_DIST_DIR);
});
it('claims a fresh build directory and refuses reuse without changing existing content',()=>{
 const root=mkdtempSync(join(tmpdir(),'chat-build-admission-'));try{
  const dir=join(root,'.next-chat-refresh-test'),stat=claimDist(dir);expect(stat.isDirectory()).toBe(true);writeFileSync(join(dir,'owned'),'preserve');expect(()=>claimDist(dir)).toThrow('fresh isolated');expect(readFileSync(join(dir,'owned'),'utf8')).toBe('preserve');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('forwards original Playwright argv without adding a selector, worker or reporter',()=>{const {scenarioArguments}=createRequire(import.meta.url)('../e2e/support/chat-refresh-owned-process.cjs');const argv=['--config','playwright.chat-read.config.ts','--project=chat-read','--max-failures=1','--shard=1/2','--reporter=json'];expect(scenarioArguments(argv)).toEqual(argv);expect(scenarioArguments(argv)).not.toBe(argv);expect(scenarioArguments([...argv,'--grep','复杂任务 | 简单聊天'])).toEqual([...argv,'--grep','复杂任务 | 简单聊天']);expect(()=>scenarioArguments([])).toThrow('explicit original');});
