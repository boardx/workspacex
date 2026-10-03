// Root operator lane: bind successful build bytes to real systemd/Docker processes.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const fail = code => { throw new Error(code); };
const sha = /^[a-f0-9]{40}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (bin,args) => execFileSync(bin,args,{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024,env:{...process.env,LC_ALL:'C',TZ:'UTC'}});
export function publicMarkerEnvironment(build,source,app,digest) {
 if(!sha.test(source??'')||!build||build.schemaVersion!==1||build.sourceSha!==source||build.appDir!==app||
   !/^[a-f0-9]{64}$/.test(build.artifactSha256??'')||build.artifactSha256!==digest||
   !Number.isFinite(Date.parse(build.observedAt??'')))fail('RUNTIME_PUBLIC_MARKER_BUILD');
 return 'WORKSPACEX_DEPLOYMENT_MARKER='+source+'\n';
}
export function verifyPublicMarkerProcesses(identity,source,read=fs) {
 if(!sha.test(source??'')||!identity.applicationProcesses?.length)fail('RUNTIME_PUBLIC_MARKER_PROCESS');
 for(const process of identity.applicationProcesses) {
  const markers=read.readFileSync('/proc/'+process.pid+'/environ').toString().split('\0').filter(value=>value.startsWith('WORKSPACEX_DEPLOYMENT_MARKER='));
  if(markers.length!==1||markers[0]!=='WORKSPACEX_DEPLOYMENT_MARKER='+source)fail('RUNTIME_PUBLIC_MARKER_PROCESS');
 }
}
export function installPublicMarker(base,dropDir,value,read=fs) {
 const safeDirectory=dir=>{const s=read.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||(s.mode&0o022))fail('RUNTIME_PUBLIC_MARKER_DIRECTORY');};
 const checkParents=file=>{for(let p=path.dirname(file);p!=='/';p=path.dirname(p))safeDirectory(p);};
 checkParents(base+'/public-runtime.env');checkParents(dropDir+'/50-workspacex-public-marker.conf');
 safeDirectory(base);safeDirectory(dropDir);
 const target=base+'/public-runtime.env',drop=dropDir+'/50-workspacex-public-marker.conf';
 const snapshot=file=>{
  if(!read.existsSync(file))return null;
  const s=read.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||(s.mode&0o777)!==0o600)fail('RUNTIME_UNSAFE_RECEIPT');
  return read.readFileSync(file);
 };
 const previous=new Map([[target,snapshot(target)],[drop,snapshot(drop)]]),temps=[],committed=[];
 const stage=(file,bytes)=>{const tmp=path.dirname(file)+'/.public-marker-'+randomUUID();temps.push(tmp);read.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});return tmp;};
 let cause;
 const errors=[];
 try {
  const envTmp=stage(target,value),dropTmp=stage(drop,'[Service]\nEnvironmentFile='+target+'\n');
  read.renameSync(envTmp,target);committed.push(target);
  read.renameSync(dropTmp,drop);committed.push(drop);
 } catch(error) {
  cause=error;
  for(const file of committed.reverse())try {
   const old=previous.get(file);if(old===null)read.unlinkSync(file);else read.renameSync(stage(file,old),file);
  } catch(restoreError){errors.push(restoreError);}
 } finally {
  for(const tmp of temps)try{if(read.existsSync(tmp))read.unlinkSync(tmp);}catch(cleanupError){errors.push(cleanupError);}
 }
 if(cause||errors.length)throw new AggregateError([...(cause?[cause]:[]),...errors],'RUNTIME_PUBLIC_MARKER_TRANSACTION');
}
export function privateFile(file) {
 for(let p=path.dirname(file);p!=='/';p=path.dirname(p)) { const s=fs.lstatSync(p); if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||(s.mode&0o022)) fail('RUNTIME_UNSAFE_PARENT'); }
 const s=fs.lstatSync(file); if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||(s.mode&0o777)!==0o600)fail('RUNTIME_UNSAFE_RECEIPT');
 return fs.readFileSync(file);
}
export function artifactDigest(app,read=fs) {
 const paths=['apps/api/src','apps/api/package.json','apps/web/.next','apps/web/public','apps/web/package.json','pnpm-lock.yaml','package.json'];
 for(const name of read.readdirSync(path.join(app,'packages')).sort()) for(const leaf of ['src','dist','package.json']) if(read.existsSync(path.join(app,'packages',name,leaf)))paths.push('packages/'+name+'/'+leaf);
 const entries=[];
 function walk(rel) {
  const p=path.join(app,rel),s=read.lstatSync(p);
  if(s.isSymbolicLink())fail('RUNTIME_ARTIFACT_SYMLINK');
  if(s.isDirectory()) {
   for(const child of read.readdirSync(p).sort()) {
    if(rel==='apps/web/.next'&&['cache','trace','trace-build'].includes(child))continue;
    walk(rel+'/'+child);
   }
  } else if(s.isFile()) entries.push([rel,hash(read.readFileSync(p))]);
  else fail('RUNTIME_ARTIFACT_SPECIAL_FILE');
 }
 for(const p of paths)walk(p);
 if(!entries.some(([p])=>p==='apps/web/.next/BUILD_ID')||!entries.some(([p])=>p==='apps/api/src/main.ts'))fail('RUNTIME_ARTIFACT_MISSING');
 return hash(JSON.stringify(entries));
}
export function verifySourceBytes(app,source,execute=run) {
 if(!sha.test(source))fail('RUNTIME_SOURCE');
 const args=['-c','safe.directory='+app,'-C',app];
 const output=execute('git',[...args,'ls-tree','-r','-z',source]);
 const tracked=new Set();
 for(const item of output.split('\0').filter(Boolean)) {
  const separator=item.indexOf('\t'),metadata=item.slice(0,separator),rel=item.slice(separator+1),[mode,type,id]=metadata.split(' ');
  if(separator<0||rel.startsWith('/')||rel.includes('\\')||/[\x00-\x1f\x7f]/.test(rel)||rel.split('/').some(segment=>segment===''||segment==='.'||segment==='..'))fail('RUNTIME_SOURCE_UNSAFE');
  if(!(/^(apps\/(api|web)\/|packages\/)/.test(rel)||['pnpm-lock.yaml','package.json','turbo.json'].includes(rel)))continue;
  if(type!=='blob'||mode==='120000')fail('RUNTIME_SOURCE_UNSAFE');
  tracked.add(rel);
  const bytes=fs.readFileSync(path.join(app,rel));
  const object=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
  if(object!==id)fail('RUNTIME_SOURCE_BYTES_DRIFT');
 }
 // TypeScript source may be loaded dynamically; include even gitignored extra files.
 function assertTrackedTree(rel) {
  const file=path.join(app,rel),s=fs.lstatSync(file);
  if(s.isSymbolicLink())fail('RUNTIME_SOURCE_UNSAFE');
  if(s.isDirectory())for(const name of fs.readdirSync(file))assertTrackedTree(rel+'/'+name);
  else if(!s.isFile()||!tracked.has(rel))fail('RUNTIME_SOURCE_UNTRACKED');
 }
 assertTrackedTree('apps/api/src');
 for(const name of fs.readdirSync(path.join(app,'packages')))if(fs.existsSync(path.join(app,'packages',name,'src')))assertTrackedTree('packages/'+name+'/src');
 // API is executed from TypeScript; untracked code must not masquerade as source.
 const untracked=execute('git',[...args,'ls-files','--others','--exclude-standard','apps/api/src','packages']);
 if(untracked.trim())fail('RUNTIME_SOURCE_UNTRACKED');
}
export function systemdIdentity(unit,expectedCwd,execute=run,read=fs) {
 const text=execute('systemctl',['show',unit,'--property=ActiveState,SubState,MainPID,InvocationID,ExecMainStartTimestampMonotonic,ControlGroup','--no-pager']);
 const s=Object.fromEntries(text.trim().split('\n').map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
 const pid=Number(s.MainPID);
 if(s.ActiveState!=='active'||s.SubState!=='running'||!Number.isSafeInteger(pid)||pid<=0||!/^[a-f0-9]{32}$/.test(s.InvocationID??'')||!/^\d+$/.test(s.ExecMainStartTimestampMonotonic??''))fail('RUNTIME_SYSTEMD_NOT_RUNNING');
 const cwd=read.readlinkSync('/proc/'+pid+'/cwd');
 if(cwd!==expectedCwd)fail('RUNTIME_PROCESS_CWD');
 const stat=read.readFileSync('/proc/'+pid+'/stat','utf8');
 const startTicks=stat.slice(stat.lastIndexOf(')')+2).split(/\s+/)[19];
 if(!/^\d+$/.test(startTicks??''))fail('RUNTIME_PROCESS_START');
 const bootId=read.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
 const executable=read.readlinkSync('/proc/'+pid+'/exe');
 const commandSha256=hash(read.readFileSync('/proc/'+pid+'/cmdline'));
 if(!/^\/system.slice\/workspacex-(api|web)\.service$/.test(s.ControlGroup??''))fail('RUNTIME_CGROUP');
 const applicationProcesses=[];
 for(const child of read.readFileSync('/sys/fs/cgroup'+s.ControlGroup+'/cgroup.procs','utf8').trim().split(/\s+/)) {
  if(!/^[1-9]\d*$/.test(child))fail('RUNTIME_CGROUP_PID');
  const args=read.readFileSync('/proc/'+child+'/cmdline').toString().replaceAll('\0',' ');
  const matches=unit==='workspacex-api'?/\b(?:tsx|node)\b/.test(args)&&/(?:^|[\s/])src\/main\.ts(?:\s|$)/.test(args):/next-server|next(?:\/dist\/bin\/next)? .*start/.test(args);
  if(!matches)continue;
  const childCwd=read.readlinkSync('/proc/'+child+'/cwd');
  const requiredCwd=unit==='workspacex-api'?expectedCwd+'/apps/api':expectedCwd;
  if(childCwd!==requiredCwd)fail('RUNTIME_APPLICATION_CWD');
  const childStat=read.readFileSync('/proc/'+child+'/stat','utf8');
  const ticks=childStat.slice(childStat.lastIndexOf(')')+2).split(/\s+/)[19];
  if(!/^\d+$/.test(ticks??''))fail('RUNTIME_APPLICATION_START');
  const bootMatch=/^btime (\d+)$/m.exec(read.readFileSync('/proc/stat','utf8'));
  const clockTicks=Number(execute('getconf',['CLK_TCK']).trim());
  if(!bootMatch||!Number.isSafeInteger(clockTicks)||clockTicks<=0)fail('RUNTIME_CLOCK');
  const startedAtUpperBound=new Date(Number(bootMatch[1])*1000+Number(ticks)*1000/clockTicks+1000).toISOString();
  applicationProcesses.push({startedAtUpperBound,pid:Number(child),startTicks:ticks,cwd:childCwd,commandSha256:hash(read.readFileSync('/proc/'+child+'/cmdline')),executableSha256:hash(read.readFileSync('/proc/'+child+'/exe'))});
 }
 if(!applicationProcesses.length)fail('RUNTIME_APPLICATION_PROCESS_MISSING');
 applicationProcesses.sort((a,b)=>a.pid-b.pid);
 return {kind:'systemd',unit,pid,invocationId:s.InvocationID,startTicks,bootId,executable,executableSha256:hash(read.readFileSync('/proc/'+pid+'/exe')),cwd,commandSha256,applicationProcesses,startMonotonicUs:s.ExecMainStartTimestampMonotonic};
}
export function dockerIdentity(name,source,execute=run) {
 const c=JSON.parse(execute('docker',['inspect',name]))[0];
 const image=JSON.parse(execute('docker',['image','inspect',c.Image]))[0];
 if(!c.State?.Running||!/^sha256:[a-f0-9]{64}$/.test(c.Image??'')||image.Id!==c.Image||image.Config?.Labels?.['org.opencontainers.image.revision']!==source||!Number.isFinite(Date.parse(c.State.StartedAt)))fail('RUNTIME_DOCKER_IDENTITY');
 return {kind:'docker',containerId:c.Id,imageId:c.Image,running:true,sourceSha:source,startedAt:c.State.StartedAt};
}
export function composeContainerName(service,execute=run) {
 const ids=execute('docker',['ps','--filter','label=com.docker.compose.project=workspacex','--filter','label=com.docker.compose.service='+service,'--format','{{.ID}}']).trim().split(/\s+/).filter(Boolean);
 if(ids.length!==1)fail('RUNTIME_COMPOSE_CONTAINER_AMBIGUOUS');
 const value=JSON.parse(execute('docker',['inspect',ids[0]]))[0];
 if(value.Config?.Labels?.['com.docker.compose.project']!=='workspacex'||value.Config?.Labels?.['com.docker.compose.service']!==service||!value.State?.Running||!/^\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value.Name??''))fail('RUNTIME_COMPOSE_CONTAINER_IDENTITY');
 return value.Name.slice(1);
}
export function assertStartedAfterBuild(build,identities) {
 if(!/^\d+$/.test(build.buildStartTicks??'')||!build.bootId)fail('RUNTIME_BUILD_TIME');
 for(const identity of Object.values(identities)) {
  if(identity.bootId!==build.bootId||BigInt(identity.startTicks)<=BigInt(build.buildStartTicks)||identity.applicationProcesses.some(p=>BigInt(p.startTicks)<=BigInt(build.buildStartTicks)))fail('RUNTIME_START_BEFORE_BUILD');
 }
}
export function collectMixedRuntime(receipt,source,provided={}) {
 const ports={run,fs,artifactDigest,...Object.fromEntries(Object.entries(provided).filter(([,v])=>v!==undefined))};
 if(receipt.schemaVersion!==1||receipt.sourceSha!==source||!sha.test(source)||!Number.isFinite(Date.parse(receipt.observedAt))||receipt.observedAt>new Date().toISOString())fail('RUNTIME_RECEIPT_BINDING');
 if(ports.artifactDigest(receipt.appDir)!==receipt.artifactSha256)fail('RUNTIME_ARTIFACT_DRIFT');
 const runtime={};
 for(const k of ['api','web']) {
  const before=receipt.systemd[k],actual=systemdIdentity(before.unit,before.cwd,ports.run,ports.fs);
  if(JSON.stringify(actual)!==JSON.stringify(before))fail('RUNTIME_PROCESS_DRIFT');
  if(k==='web')verifyPublicMarkerProcesses(actual,source,ports.fs??fs);
  runtime[k]={...actual,running:true,sourceSha:source,artifactSha256:receipt.artifactSha256,startedAt:receipt.processStartedAt[k]};
 }
 for(const k of ['agent','sandbox']) {
  const actual=dockerIdentity(receipt.containerNames[k],source,ports.run);
  if(JSON.stringify(actual)!==JSON.stringify(receipt.docker[k]))fail('RUNTIME_CONTAINER_DRIFT');
  runtime[k]=actual;
 }
 const sessions=dockerIdentity(receipt.relatedContainerNames.sessions,source,ports.run);
 if(JSON.stringify(sessions)!==JSON.stringify(receipt.relatedDocker.sessions))fail('RUNTIME_CONTAINER_DRIFT');
 runtime.sandbox.relatedContainers={sessions};
 return runtime;
}
function rootDir(p) {
 if(!fs.existsSync(p))fs.mkdirSync(p,{mode:0o700});
 const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||(s.mode&0o777)!==0o700)fail('RUNTIME_PROTECTED_DIRECTORY');
}
function writeExclusive(p,value) {fs.writeFileSync(p,JSON.stringify(value),{mode:0o600,flag:'wx'});}
function main() {
 const [kind,source,app='/opt/workspacex/app',buildFile]=process.argv.slice(2);
 if(kind==='verify-source') {
  if(process.argv.length!==5)fail('RUNTIME_COMMAND');
  verifySourceBytes(app,source);console.log('DEVAPP_RUNTIME_SOURCE_VERIFIED');return;
 }
 if(process.getuid?.()!==0)fail('RUNTIME_ROOT_REQUIRED');
 const base='/etc/workspacex-devapp';rootDir(base);
 if(kind==='build') {
  verifySourceBytes(app,source);
  const value={schemaVersion:1,sourceSha:source,appDir:app,artifactSha256:artifactDigest(app),observedAt:new Date().toISOString(),buildStartTicks:String(Math.floor(Number(fs.readFileSync('/proc/uptime','utf8').split(' ')[0])*Number(run('getconf',['CLK_TCK']).trim()))),bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()};
  const p=base+'/build-'+source+'-'+randomUUID()+'.json';writeExclusive(p,value);console.log(p);return;
 }
 if(kind==='publish-marker') {
  verifySourceBytes(app,source);
  const value=publicMarkerEnvironment(JSON.parse(privateFile(buildFile)),source,app,artifactDigest(app));
  const dropDir='/etc/systemd/system/workspacex-web.service.d';
  // Provision only a missing dedicated directory; validate every parent before live writes.
  if(!fs.existsSync(dropDir)) {
   const parent=fs.lstatSync(path.dirname(dropDir));if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||parent.gid!==0||(parent.mode&0o022))fail('RUNTIME_PUBLIC_MARKER_DIRECTORY');
   fs.mkdirSync(dropDir,{mode:0o755});
  }
  installPublicMarker(base,dropDir,value);
  console.log('DEVAPP_PUBLIC_MARKER_PREPARED');return;
 }
 if(kind==='attest') {
  const b=JSON.parse(privateFile(buildFile));
  if(b.sourceSha!==source||b.appDir!==app||artifactDigest(app)!==b.artifactSha256)fail('RUNTIME_BUILD_DRIFT');
  const systemd={api:systemdIdentity('workspacex-api',app),web:systemdIdentity('workspacex-web',app+'/apps/web')};
  verifyPublicMarkerProcesses(systemd.web,source);
  // /proc start ticks are monotonic; systemd exposes the start's real UTC for browser binding.
  assertStartedAfterBuild(b,systemd);
  const processStartedAt={};
  for(const k of ['api','web']) {
   const start=run('systemctl',['show',systemd[k].unit,'--property=ExecMainStartTimestamp','--value']).trim();
   const milliseconds=Date.parse(start);if(!Number.isFinite(milliseconds))fail('RUNTIME_START_BEFORE_BUILD');
   processStartedAt[k]=new Date(milliseconds).toISOString();
  }
  const containerNames={agent:'workspacex-deep-agent',sandbox:composeContainerName('skill-sandbox')};
  const docker=Object.fromEntries(Object.entries(containerNames).map(([k,n])=>[k,dockerIdentity(n,source)]));
  const relatedContainerNames={sessions:composeContainerName('skill-sandbox-sessions')};
  const relatedDocker={sessions:dockerIdentity(relatedContainerNames.sessions,source)};
  const receipt={...b,relatedContainerNames,relatedDocker,buildReceiptSha256:hash(privateFile(buildFile)),observedAt:new Date().toISOString(),systemd,processStartedAt,containerNames,docker};
  collectMixedRuntime(receipt,source);
  const receiptPath=base+'/runtime-'+source+'-'+randomUUID()+'.json';writeExclusive(receiptPath,receipt);
  const config=base+'/runtime-evidence.json',tmp=base+'/.runtime-config-'+randomUUID();
  if(fs.existsSync(config))privateFile(config);
  writeExclusive(tmp,{schemaVersion:2,receiptPath});fs.renameSync(tmp,config);
  console.log('DEVAPP_RUNTIME_IDENTITY_RECORDED');return;
 }
 fail('RUNTIME_COMMAND');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)try{main();}catch{console.error('DEVAPP_RUNTIME_IDENTITY_NOT_READY');process.exitCode=3;}
