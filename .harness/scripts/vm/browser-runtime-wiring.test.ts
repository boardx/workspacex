import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const app=resolve(import.meta.dirname,'../../..');
function run(existing:string,ready=true){
 const dir=mkdtempSync(join(tmpdir(),'browser-wiring-'));const file=join(dir,'deploy.env');
 writeFileSync(file,existing);
 try{
  const result=spawnSync('bash',['-euc',`
source "$1/.harness/scripts/vm/deep-agent-lib.sh"
probe_exit=$3
docker() { printf 'docker:%s\\n' "$*"; }
node() { printf 'probe:%s\\n' "$WORKSPACEX_BROWSER_MCP_ENDPOINT"; return "$probe_exit"; }
sleep() { :; }
browser_runtime_ensure_ready "$1" "$2"
`, 'test',app,file,ready?'0':'1'],{encoding:'utf8'});
  return {...result,env:readFileSync(file,'utf8')};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
it('backfills missing endpoint only after MCP readiness and uses the controlled compose stack',()=>{
 const result=run('EXISTING=preserved\n');
 expect(result.status).toBe(0);expect(result.env).toContain('WORKSPACEX_BROWSER_MCP_ENDPOINT=http://127.0.0.1:58931/mcp');
 expect(result.stdout).toContain('docker-compose.browser.yml -p wsx-browser-runtime up -d');
 expect(result.stdout).toContain('probe:http://127.0.0.1:58931/mcp');
 expect(result.env).toContain('EXISTING=preserved');
});
it('preserves existing endpoint without duplicate lines',()=>{
 const env='WORKSPACEX_BROWSER_MCP_ENDPOINT=http://127.0.0.1:58932/mcp\n';
 const result=run(env);expect(result.status).toBe(0);expect(result.env).toBe(env);
 expect(result.stdout).toContain('probe:http://127.0.0.1:58932/mcp');
});
it('fails visibly without publishing config when MCP is unavailable',()=>{
 const result=run('EXISTING=preserved\n',false);expect(result.status).not.toBe(0);
 expect(result.env).not.toContain('WORKSPACEX_BROWSER_MCP_ENDPOINT');
 expect(result.stderr).toContain('MCP readiness failed');
});
it('refuses an untrusted endpoint before invoking docker or probe',()=>{
 const result=run('WORKSPACEX_BROWSER_MCP_ENDPOINT=http://public.invalid/mcp\n');
 expect(result.status).not.toBe(0);expect(result.stdout).not.toContain('docker:');
});
it('standard deployment wires browser readiness before restarting API',()=>{
 const source=readFileSync(join(app,'.harness/scripts/vm/deploy.sh'),'utf8');
 const provision=source.indexOf('browser_runtime_ensure_ready "$APP_DIR" "$ENV_FILE"');
 expect(provision).toBeGreaterThan(0);
 expect(source.indexOf('systemctl restart workspacex-api')).toBeGreaterThan(provision);
});
