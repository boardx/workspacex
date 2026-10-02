import { describe,it,expect,afterEach } from 'vitest';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { artifactDigest,verifySourceBytes,systemdIdentity,dockerIdentity,collectMixedRuntime,composeContainerName,assertStartedAfterBuild } from './devapp-runtime-identity.mjs';
const source='a'.repeat(40),image='sha256:'+'b'.repeat(64),dirs:string[]=[];
afterEach(()=>{for(const p of dirs.splice(0))rmSync(p,{recursive:true,force:true})});
function fixture(){const p=mkdtempSync(join(tmpdir(),'runtime-identity-'));dirs.push(p);for(const n of ['apps/api/src','apps/web/.next/server','apps/web/.next/cache','apps/web/public','packages/foo/src','packages/foo/dist'])mkdirSync(join(p,n),{recursive:true});for(const n of ['apps/api/src/main.ts','apps/api/package.json','apps/web/.next/BUILD_ID','apps/web/.next/server/app.js','apps/web/package.json','package.json','pnpm-lock.yaml','packages/foo/src/index.ts','packages/foo/dist/index.js'])writeFileSync(join(p,n),'original');return p}
function processPorts(kind='api'){
 const unit='workspacex-'+kind,app='/opt/workspacex/app',cwd=kind==='api'?app:app+'/apps/web';
 const files:any={
  '/proc/123/stat':'123 (pnpm) '+['S',...Array(18).fill('0'),'12345'].join(' '),
  '/proc/124/stat':'124 (node) '+['S',...Array(18).fill('0'),'12346'].join(' '),
  '/proc/sys/kernel/random/boot_id':'boot-identity','/proc/stat':'btime 1790800000\n',
  '/proc/123/cmdline':Buffer.from('pnpm\0run\0start\0'),'/proc/123/exe':Buffer.from('node executable'),
  '/proc/124/cmdline':Buffer.from(kind==='api'?'node\0tsx\0src/main.ts\0':'next-server (v15)\0'),'/proc/124/exe':Buffer.from('node executable'),
  ['/sys/fs/cgroup/system.slice/'+unit+'.service/cgroup.procs']:'123\n124\n'};
 const links:any={'/proc/123/cwd':cwd,'/proc/123/exe':'/usr/bin/node','/proc/124/cwd':kind==='api'?app+'/apps/api':cwd};
 return {cwd,files,links,read:{readFileSync:(p:string,encoding?:string)=>{if(!(p in files))throw Error('MISSING');return encoding?String(files[p]):Buffer.from(files[p])},readlinkSync:(p:string)=>links[p]},run:(_bin?:string,args?:string[])=>_bin==='getconf'?'100':`ActiveState=active\nSubState=running\nMainPID=123\nInvocationID=${'c'.repeat(32)}\nExecMainStartTimestampMonotonic=123450000\nControlGroup=/system.slice/${unit}.service\n`};
}
function dockerRun(){return (bin:string,args:string[])=>JSON.stringify(args[0]==='inspect'?[{Id:'container',Image:image,State:{Running:true,StartedAt:'2026-10-01T00:00:00Z'}}]:[{Id:image,Config:{Labels:{'org.opencontainers.image.revision':source}}}])}
describe('Devapp runtime identity actual mixed topology',()=>{
 it('binds API source, package generated output, and Next output; mutable cache does not replace identity',()=>{const p=fixture(),a=artifactDigest(p);writeFileSync(join(p,'apps/web/.next/cache/transient'),'cache');expect(artifactDigest(p)).toBe(a);writeFileSync(join(p,'packages/foo/dist/index.js'),'changed');expect(artifactDigest(p)).not.toBe(a);writeFileSync(join(p,'apps/web/.next/server/app.js'),'changed');expect(artifactDigest(p)).not.toBe(a)});
 it('rejects executable artifact symlink instead of hashing a movable target',()=>{const p=fixture();symlinkSync('/tmp/other',join(p,'apps/api/src/extra.ts'));expect(()=>artifactDigest(p)).toThrow('RUNTIME_ARTIFACT_SYMLINK')});
 it('verifies runtime source bytes against Git blobs, not checkout HEAD',()=>{const p=fixture(),bytes=Buffer.from('original'),id=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');const run=(_b:string,args:string[])=>args.includes('ls-tree')?`100644 blob ${id}\tapps/api/src/main.ts\0`+`100644 blob ${id}\tpackages/foo/src/index.ts\0`:'';expect(()=>verifySourceBytes(p,source,run)).not.toThrow();writeFileSync(join(p,'apps/api/src/main.ts'),'wrong');expect(()=>verifySourceBytes(p,source,run)).toThrow('RUNTIME_SOURCE_BYTES_DRIFT')});
 it('rejects a real gitignored API source file after a clean exact-source pass',()=>{
  const p=fixture();writeFileSync(join(p,'.gitignore'),'apps/api/src/extra.ts\n');
  const git=(...args:string[])=>execFileSync('git',['-C',p,...args],{encoding:'utf8'});
  git('init','--quiet');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','--quiet','-m','isolated runtime fixture');
  const revision=git('rev-parse','HEAD').trim();expect(()=>verifySourceBytes(p,revision)).not.toThrow();
  writeFileSync(join(p,'apps/api/src/extra.ts'),'injected');expect(git('check-ignore','apps/api/src/extra.ts').trim()).toBe('apps/api/src/extra.ts');
  expect(git('status','--porcelain')).toBe('');expect(()=>verifySourceBytes(p,revision)).toThrow('RUNTIME_SOURCE_UNTRACKED');
 });
 it('queries real systemd process and application child; active wrapper without app is not accepted',()=>{const p=processPorts();const id=systemdIdentity('workspacex-api',p.cwd,p.run,p.read);expect(id.applicationProcesses).toHaveLength(1);p.files['/proc/124/cmdline']=Buffer.from(['sleep','100',''].join('\0'));expect(()=>systemdIdentity('workspacex-api',p.cwd,p.run,p.read)).toThrow('RUNTIME_APPLICATION_PROCESS_MISSING')});
 it('rejects PID reuse, foreign process cwd, missing application child, and stopped unit',()=>{const p=processPorts();p.links['/proc/124/cwd']='/other';expect(()=>systemdIdentity('workspacex-api',p.cwd,p.run,p.read)).toThrow('RUNTIME_APPLICATION_CWD');expect(()=>systemdIdentity('workspacex-api',p.cwd,()=>p.run().replace('active','inactive'),p.read)).toThrow('RUNTIME_SYSTEMD_NOT_RUNNING')});
 it('Docker image immutable ID and OCI source must both match current container',()=>{expect(dockerIdentity('agent',source,dockerRun()).sourceSha).toBe(source);expect(()=>dockerIdentity('agent','f'.repeat(40),dockerRun())).toThrow('RUNTIME_DOCKER_IDENTITY')});
 it('discovers the unique running sandbox by actual Compose labels, never assumes a generated name',()=>{const run=(_bin:string,args:string[])=>args[0]==='ps'?'abc123\n':JSON.stringify([{Name:'/observed-custom-sandbox',State:{Running:true},Config:{Labels:{'com.docker.compose.project':'workspacex','com.docker.compose.service':'skill-sandbox'}}}]);expect(composeContainerName('skill-sandbox',run)).toBe('observed-custom-sandbox');expect(()=>composeContainerName('skill-sandbox',()=> 'abc def')).toThrow('RUNTIME_COMPOSE_CONTAINER_AMBIGUOUS')});
 it('rejects a pre-build application child even with a fresh systemd parent; rejects reboot',()=>{const build={buildStartTicks:'100',bootId:'boot'},id={startTicks:'102',bootId:'boot',applicationProcesses:[{startTicks:'101'}]};expect(()=>assertStartedAfterBuild(build,{api:id})).not.toThrow();id.applicationProcesses[0].startTicks='99';expect(()=>assertStartedAfterBuild(build,{api:id})).toThrow('RUNTIME_START_BEFORE_BUILD');id.bootId='other';expect(()=>assertStartedAfterBuild(build,{api:id})).toThrow('RUNTIME_START_BEFORE_BUILD')});
 it('fresh collection rejects artifact drift before reporting runtime source',()=>{const receipt={schemaVersion:1,sourceSha:source,observedAt:'2026-10-01T00:00:00Z',artifactSha256:'old',appDir:'/app'};expect(()=>collectMixedRuntime(receipt,source,{artifactDigest:()=> 'new'})).toThrow('RUNTIME_ARTIFACT_DRIFT')});
});
