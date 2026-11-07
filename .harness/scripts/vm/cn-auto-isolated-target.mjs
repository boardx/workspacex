// Validate the actual attempt-owned Docker target before a canonical bootstrap
// probe. This explicit local target never changes production TLS policy.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const hash=v=>createHash('sha256').update(v).digest('hex');
const fail=()=>{throw Error('CN_AUTO_ISOLATED_TARGET_UNPROVEN');};
export function validateTarget({binding,source,baseline,attempt,plan,manifest,postgres,network,environment,now=Date.now(),mtime=now}){
 const identity=binding.identity;
 if(binding.schemaVersion!==1||binding.kind!=='cn-auto-isolated-target'||binding.isolationScope!=='attempt-local-docker'||!identity||identity.sourceRevision!==source||identity.baselineSourceRevision!==baseline||identity.attemptId!==attempt||identity.release!==manifest.release||binding.migrationPlanSha256!==plan.planSha256||manifest.sourceRevision!==source||binding.candidateApiImage!==manifest.images.api.image||binding.database!=='workspacex'||now<mtime||now-mtime>3600000)fail();
 if(!/^[a-f0-9]{20}$/.test(binding.ownerLabel)||binding.networkName!==`wsx-autop-${binding.ownerLabel}-net`||network.Name!==binding.networkName||network.Id!==binding.networkId||network.Internal!==true||network.Labels?.['wsx.auto.owner']!==binding.ownerLabel)fail();
 if(postgres.Id!==binding.postgresContainerId||postgres.Image!==binding.postgresImageId||postgres.Name!==`/wsx-autop-${binding.ownerLabel}-pg`||postgres.Config?.Labels?.['wsx.auto.owner']!==binding.ownerLabel||postgres.State?.Running!==true||postgres.HostConfig?.NetworkMode!==binding.networkName||Object.values(postgres.HostConfig?.PortBindings??{}).some(v=>v?.length)||Object.keys(postgres.NetworkSettings?.Networks??{}).join()!==binding.networkName||postgres.NetworkSettings.Networks[binding.networkName].NetworkID!==network.Id)fail();
 const env=Object.fromEntries(environment.trimEnd().split('\n').map(line=>{const at=line.indexOf('=');if(at<1||!/^[A-Z][A-Z0-9_]*$/.test(line.slice(0,at))||/[\r\0]/.test(line))fail();return [line.slice(0,at),line.slice(at+1)];}));
 if(env.PGHOST!=='postgres'||env.PGPORT!=='5432'||env.PGDATABASE!=='workspacex'||env.PGSSLMODE!=='disable'||env.REDIS_HOST!=='redis'||env.REDIS_TLS!=='false'||env.WORKSPACEX_DEPLOY_PROFILE!=='starter'||!env.APP_DB_PASSWORD)fail();
 return {networkName:binding.networkName};
}
function protectedRead(file){
 for(let dir=path.dirname(file);;dir=path.dirname(dir)){const st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||(st.mode&0o022))fail();if(dir==='/')break;}
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd);if(!before.isFile()||before.uid!==0||before.gid!==0||(before.mode&0o777)!==0o600||before.nlink!==1||before.size>16*1024*1024)fail();const bytes=fs.readFileSync(fd);const end=fs.fstatSync(fd);if(before.ino!==end.ino||before.size!==end.size||before.mtimeMs!==end.mtimeMs||before.ctimeMs!==end.ctimeMs)fail();return {bytes,mtime:before.mtimeMs};}finally{fs.closeSync(fd);}
}
export function main(args){
 const [source,baseline,attempt,output]=args;
 if(process.getuid?.()!==0||args.length!==4||!/^[a-f0-9]{40}$/.test(source??'')||!/^[a-f0-9]{40}$/.test(baseline??'')||!/^gha-[0-9]+-[0-9]+$/.test(attempt??'')||!/^\/tmp\/workspacex-cn-preflight-collect\.[A-Za-z0-9]+\/bootstrap\.env$/.test(output??''))fail();
 const root=`/var/lib/workspacex-cn/auto-preparation/${source}/${attempt}`;
 const raw=protectedRead(root+'/isolated-target.json'),binding=JSON.parse(raw.bytes);
 if(binding.bootstrapEnvironment?.path!==root+'/runtime/bootstrap.env')fail();
 const environment=protectedRead(binding.bootstrapEnvironment.path).bytes;
 if(hash(environment)!==binding.bootstrapEnvironment.sha256)fail();
 const read=file=>JSON.parse(protectedRead(file).bytes);
 const plan=read(`/etc/workspacex-cn/migration-plans/${source}/${attempt}/plan.json`);
 const request=read(`/etc/workspacex-cn/auto-preparation-requests/${source}/${attempt}.json`);
 if(request.manifest?.path!==root+'/input-manifest.json')fail();
 const manifestBytes=protectedRead(request.manifest.path).bytes;
 if(hash(manifestBytes)!==request.manifest.sha256)fail();
 const manifest=JSON.parse(manifestBytes);
 const inspect=(kind,id)=>JSON.parse(execFileSync('/usr/bin/docker',['--host','unix:///var/run/docker.sock','--config','/nonexistent',kind,'inspect',id],{maxBuffer:2*1024*1024,stdio:['ignore','pipe','ignore']}))[0];
 if(!/^[a-f0-9]{64}$/.test(binding.postgresContainerId??'')||!/^wsx-autop-[a-f0-9]{20}-net$/.test(binding.networkName??''))fail();
 const result=validateTarget({binding,source,baseline,attempt,plan,manifest,postgres:inspect('container',binding.postgresContainerId),network:inspect('network',binding.networkName),environment:environment.toString(),mtime:raw.mtime});
 // The collector owns this fresh private temporary file; never follows a link.
 const fd=fs.openSync(output,fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW);
 try{const st=fs.fstatSync(fd);if(!st.isFile()||st.uid!==0||st.gid!==0||(st.mode&0o777)!==0o600||st.nlink!==1)fail();fs.ftruncateSync(fd,0);fs.writeFileSync(fd,environment);}finally{fs.closeSync(fd);}
 process.stdout.write(result.networkName+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{main(process.argv.slice(2));}catch{process.stderr.write('CN_AUTO_ISOLATED_TARGET_UNPROVEN\n');process.exitCode=3;}}
