import { afterEach, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { parse } from 'yaml';
const root=new URL('../../../',import.meta.url);
const workflow=parse(readFileSync(new URL('.github/workflows/devapp-install-trusted-scripts.yml',root),'utf8'));
const verification=workflow.jobs.install.steps.find((s: {name?: string})=>s.name?.startsWith('复核：')).run;
const targets=[['deploy.sh','/usr/local/bin/workspacex-deploy',0o755],['deploy-readiness.sh','/usr/local/lib/workspacex-deploy-readiness.sh',0o644],['deep-agent-lib.sh','/usr/local/lib/workspacex-deep-agent-lib.sh',0o644],['devapp-runtime-identity.mjs','/usr/local/lib/workspacex-devapp-runtime-identity.mjs',0o644]] as const;
const temps:string[]=[];
afterEach(()=>{for(const p of temps.splice(0))rmSync(p,{recursive:true,force:true});});
function verify(kind='valid'){
 const dir=mkdtempSync(join(tmpdir(),'devapp-trusted-verification-'));temps.push(dir);let body=verification;
 for(const [source,target,mode] of targets){
  const file=join(dir,source);body=body.replaceAll(target,file);
  if(source==='devapp-runtime-identity.mjs'&&kind==='missing')continue;
  writeFileSync(file,execFileSync('git',['show','HEAD:.harness/scripts/vm/'+source]));chmodSync(file,mode);
  if(source==='devapp-runtime-identity.mjs'){
   if(kind==='stale')writeFileSync(file,'old module');
   if(kind==='mode')chmodSync(file,0o666);
   if(kind==='symlink'){const link=file+'.target';writeFileSync(link,readFileSync(file));rmSync(file);symlinkSync(link,file);}
  }
 }
 // Only this extracted test body receives a metadata shim. It maps this unprivileged
 // fixture's uid/gid to root; type, mode and link count come from actual lstat.
 // The production workflow has no fixture env/path or owner override.
 const shim=`stat(){ python3 -c 'import os,stat,sys;s=os.lstat(sys.argv[1]);bad=sys.argv[2]=="owner" and sys.argv[1].endswith("devapp-runtime-identity.mjs");print("%d:0:%o:%d" % (123 if bad else 0,stat.S_IMODE(s.st_mode),s.st_nlink))' "$3" "$FIXTURE_KIND"; }\n`;
 const result=spawnSync('bash',['-euo','pipefail','-c',shim+body],{encoding:'utf8',env:{...process.env,FIXTURE_KIND:kind},timeout:5000});
 return result;
}
it('reproduces old three matching targets while rejecting the absent fourth module',()=>{
 const result=verify('missing');expect(result.status,result.stdout+result.stderr).not.toBe(0);expect(result.stderr+result.stdout).toContain('DEVAPP_TRUSTED_SCRIPTS_NOT_READY');
});
it('accepts all four matching bytes with required root owner, modes and ordinary files',()=>{const r=verify();expect(r.status,r.stdout+r.stderr).toBe(0);});
for(const kind of ['stale','owner','mode','symlink'])it(`rejects fourth module ${kind}`,()=>{const r=verify(kind);expect(r.status,r.stdout+r.stderr).not.toBe(0);expect(r.stdout+r.stderr).toContain('DEVAPP_TRUSTED_SCRIPTS_NOT_READY');});
it('keeps the fixed no-argument privileged entry and has no fixture override in production',()=>{
 expect(workflow.jobs.install.steps.find((s:{run?:string})=>s.run?.includes('sudo -n')).run).toBe('sudo -n /usr/local/bin/workspacex-install-trusted-scripts');
 expect(verification).not.toMatch(/FIXTURE|TRUSTED_LIB_DIR|\bsudo\b|\binstall -o/);
});
