import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { validateReleaseManifest, verifyPrewarmedRelease } from '../release';
import type { MaintenanceIdentity } from '../cn-maintenance-release';
export interface DockerRuntime { path: '/usr/bin/docker'; sha256: string }
export function localImageInspectionArgs(image: string): readonly string[] {
 if(!/^[-a-zA-Z0-9._/:]+@sha256:[a-f0-9]{64}$/.test(image))throw new Error('OFFLINE_IMAGE_REFERENCE');
 return ['--config','/etc/workspacex-cn/docker-offline','--host','unix:///run/docker.sock','image','inspect',image];
}
/** Only local image inspection is implemented; no command supplied by a plan. */
export async function inspectLocalImage(runtime: DockerRuntime, image: string): Promise<string> {
 if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('ROOT_LINUX_REQUIRED');
 if(runtime.path!=='/usr/bin/docker'||!/^[a-f0-9]{64}$/.test(runtime.sha256)||!/^[-a-zA-Z0-9._/:]+@sha256:[a-f0-9]{64}$/.test(image))throw new Error('OFFLINE_DOCKER_BINDING');
 for(const path of ['/usr','/usr/bin','/etc','/etc/workspacex-cn','/run']){const s=lstatSync(path);if(!s.isDirectory()||s.uid!==0||s.gid!==0||(s.mode&0o022))throw new Error('OFFLINE_DOCKER_PARENT');}
 const config=lstatSync('/etc/workspacex-cn/docker-offline'),socket=lstatSync('/run/docker.sock');
 if(!config.isDirectory()||config.uid!==0||config.gid!==0||(config.mode&0o777)!==0o700||readdirSync('/etc/workspacex-cn/docker-offline').length!==0||!socket.isSocket()||socket.uid!==0)throw new Error('OFFLINE_LOCAL_DAEMON_BINDING');
 const before=lstatSync(runtime.path),fd=openSync(runtime.path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try {
 const s=fstatSync(fd);if(!s.isFile()||s.uid!==0||s.gid!==0||s.nlink!==1||(s.mode&0o777)!==0o755||s.dev!==before.dev||s.ino!==before.ino||createHash('sha256').update(readFileSync(fd)).digest('hex')!==runtime.sha256)throw new Error('OFFLINE_DOCKER_RUNTIME');
 return await new Promise<string>((resolve,reject)=>{const c=spawn('/proc/self/fd/10',[...localImageInspectionArgs(image)],{shell:false,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe','ignore','ignore','ignore','ignore','ignore','ignore','ignore',fd]});let output='',bytes=0,timedOut=false;const timer=setTimeout(()=>{timedOut=true;c.kill('SIGKILL');},30000);c.stdout!.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>1048576)c.kill('SIGKILL');else output+=b;});c.stderr!.resume();c.on('error',()=>{clearTimeout(timer);reject(new Error('OFFLINE_DOCKER_SPAWN'));});c.on('close',code=>{clearTimeout(timer);code===0&&!timedOut&&bytes<=1048576?resolve(output):reject(new Error('OFFLINE_DOCKER_INSPECT'));});});
 }finally{closeSync(fd);}
}
export function verifyOfflineManifest(identity: MaintenanceIdentity, bytes: Buffer, expectedSha256: string, runtime: DockerRuntime, inspect: (runtime:DockerRuntime,image:string)=>Promise<string> = inspectLocalImage) {
 return async()=>{
 if(!/^[a-f0-9]{64}$/.test(expectedSha256)||createHash('sha256').update(bytes).digest('hex')!==expectedSha256)throw new Error('OFFLINE_MANIFEST_HASH');
 const manifest=validateReleaseManifest(JSON.parse(bytes.toString('utf8')));
 if(manifest.sourceRevision!==identity.sourceRevision)throw new Error('OFFLINE_APPLICATION_IDENTITY');
 // All six immutable images are independently inspected even for managed DBs.
 await verifyPrewarmedRelease(manifest,'starter',async argv=>{if(argv.length!==4||argv[0]!=='docker'||argv[1]!=='image'||argv[2]!=='inspect'||!argv[3])throw new Error('OFFLINE_INSPECT_ONLY');return inspect(runtime,argv[3]);});
 };
}
