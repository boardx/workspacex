/** Derive the attempt request from real protected host artifacts after sealing.
 * This does not assert that backup, restore, browser or preparation succeeded. */
import {constants} from 'node:fs';
import {open,mkdir,readlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {assertTrustedPath} from './trusted-path';
import {autoIdentitySchema} from './cn-auto-preparation-protocol';
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
async function directory(path:string){
 await assertTrustedPath(dirname(path),{trustedRoot:'/',kind:'directory',private:true});
 await mkdir(path,{mode:0o700}).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='EEXIST')throw e;});
 await assertTrustedPath(path,{trustedRoot:'/',kind:'directory',private:true});
}
async function read(path:string,isPrivate=true){
 await assertTrustedPath(path,{trustedRoot:'/',kind:'file',private:isPrivate});
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const before=await fd.stat();if(before.nlink!==1||before.size>16*1024*1024)throw Error();const bytes=await fd.readFile();const end=await fd.stat();if(before.ino!==end.ino||before.size!==end.size||before.mtimeMs!==end.mtimeMs||before.ctimeMs!==end.ctimeMs)throw Error();return bytes;}finally{await fd.close();}
}
async function write(path:string,bytes:Uint8Array){
 await assertTrustedPath(dirname(path),{trustedRoot:'/',kind:'directory',private:true});
 const fd=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
 return {path,sha256:hash(bytes)};
}
try{
 const [sha,release,attempt,...extra]=process.argv.slice(2);
 if(process.getuid?.()!==0||process.platform!=='linux'||extra.length||!/^[a-f0-9]{40}$/.test(sha??'')||!/^gha-[0-9]+-[0-9]+$/.test(attempt??'')||await readlink('/proc/self/fd/9')!=='/var/lib/workspacex-cn/runtime/release.lock')throw Error();
 const driver='/usr/local/lib/workspacex-cn/cn_compose_baseline.py';
 await assertTrustedPath(driver,{trustedRoot:'/',kind:'file'});
 const baseline=execFileSync('/usr/bin/python3',['-I','-B',driver,'capture'],{stdio:['ignore','pipe','ignore'],maxBuffer:2*1024*1024});
 const snapshot=JSON.parse(baseline.toString());
 const nginx=await read('/etc/nginx/conf.d/workspacex-cn.conf',false);
 if(snapshot.schemaVersion!==2||snapshot.nginxSha256!==hash(nginx))throw Error();
 const fingerprint=createHash('sha256');for(const bytes of [baseline,nginx])fingerprint.update(`${bytes.length}:${hash(bytes)}\n`);
 const identity=autoIdentitySchema.parse({sourceRevision:sha,baselineSourceRevision:snapshot.sourceRevision,baselineSha256:fingerprint.digest('hex'),release,attemptId:attempt});
 const root='/var/lib/workspacex-cn/auto-preparation';
 await assertTrustedPath(root,{trustedRoot:'/',kind:'directory',private:true});
 await directory(`${root}/${sha}`);await directory(`${root}/${sha}/${attempt}`);
 const work=`${root}/${sha}/${attempt}`;
 await write(work+'/preparation-baseline.json',baseline);
 // These byte-preserving private copies allow strict receipt consumers to read
 // the published manifest/seal, whose original mode is root:runner 0640.
 const manifest=await write(work+'/input-manifest.json',await read(`/etc/workspacex-cn/releases/${sha}.json`,false));
 const seal=await write(work+'/input-seal.json',await read(`/etc/workspacex-cn/releases/${sha}.sealed.json`,false));
 const ref=async(path:string)=>({path,sha256:hash(await read(path))});
 const pf=`/var/lib/workspacex-cn/preflight-receipts/${sha}/${attempt}`;
 const request={identity,manifest,seal,migrationPlan:await ref(`/etc/workspacex-cn/migration-plans/${sha}/${attempt}/plan.json`),prebuild:{evidence:await ref(pf+'/prebuild.json'),validation:await ref(pf+'/prebuild.validated.json')}};
 const requests='/etc/workspacex-cn/auto-preparation-requests';
 await assertTrustedPath(requests,{trustedRoot:'/',kind:'directory',private:true});await directory(`${requests}/${sha}`);
 await write(`${requests}/${sha}/${attempt}.json`,Buffer.from(JSON.stringify(request)+'\n'));
 process.stdout.write('CN_AUTO_PREPARATION_REQUEST_DERIVED\n');
}catch{process.stderr.write('CN_AUTO_PREPARATION_REQUEST_NOT_READY\n');process.exitCode=3;}
