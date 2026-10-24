/** Read-only diagnostic, not release admission. Never creates/copies/rotates keys.
 * Production has five observable generated-key identities; its seven data keys
 * come from external secretRefs and cannot be inferred from bootstrap.env. */
import {constants} from 'node:fs';
import {open,lstat,readdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {timingSafeEqual} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {stableDeploymentSecretNames} from '../../../packages/cloud-deploy/src/runtime-environment';
import {verifyStableSecretConsumers} from '../../../packages/cloud-deploy/src/stable-secret-continuity';
import {assertTrustedPath} from '../../../packages/cloud-deploy/src/trusted-path';
const fail=()=>{throw Error('CN_STABLE12_READONLY_UNPROVEN');};
export function canonicalLiveConsumers(text:string){
 verifyStableSecretConsumers(text);
 const source=ts.createSourceFile('runtime-environment.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const objects=new Map<string,ts.ObjectLiteralExpression>();
 const collect=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer&&ts.isObjectLiteralExpression(node.initializer))objects.set(node.name.text,node.initializer);ts.forEachChild(node,collect);};collect(source);
 const expand=(name:string,seen=new Set<string>()):Record<string,string>=>{
  if(seen.has(name))return {};seen.add(name);const result:Record<string,string>={};
  for(const node of objects.get(name)?.properties??[]){
   if(ts.isSpreadAssignment(node)&&ts.isIdentifier(node.expression))Object.assign(result,expand(node.expression.text,new Set(seen)));
   if(ts.isPropertyAssignment(node)&&ts.isIdentifier(node.name)&&ts.isElementAccessExpression(node.initializer)&&ts.isIdentifier(node.initializer.expression)&&node.initializer.expression.text==='secret'&&node.initializer.argumentExpression&&ts.isStringLiteral(node.initializer.argumentExpression))result[node.name.text]=node.initializer.argumentExpression.text;
  }return result;
 };
 return {api:expand('api'),agent:expand('agent'),bootstrap:expand('bootstrap')};
}
export function equalSecret(left:string|undefined,right:string|undefined){return left!==undefined&&right!==undefined&&Buffer.byteLength(left)===Buffer.byteLength(right)&&timingSafeEqual(Buffer.from(left),Buffer.from(right));}
export function compareKey(key:string,value:string|undefined,legacyValue:string|undefined,observations:(string|undefined)[],stableOwnerModeOk:boolean,legacyOwnerModeOk:boolean){
 const legacySame=legacyValue===undefined||value===undefined?null:equalSecret(legacyValue,value);
 const liveSame=!observations.length||value===undefined||observations.some(v=>v===undefined)?null:observations.every(v=>equalSecret(v,value));
 return {key,stablePresent:value!==undefined,stableOwnerModeOk,legacyPresent:legacyValue!==undefined,legacyOwnerModeOk,legacySame,liveConsumerPresent:observations.length>0,liveSame,status:legacySame===false||liveSame===false?'mismatch':legacySame===true?'same':liveSame===true?'live-same':'unknown'};
}
function parseEnvironment(lines:string[]){
 const result:Record<string,string>={};for(const line of lines){if(!line)continue;const at=line.indexOf('=');const key=line.slice(0,at);if(at<1||!/^[A-Z][A-Z0-9_]*$/.test(key)||key in result||/[\r\0]/.test(line))fail();result[key]=line.slice(at+1);}return result;
}
async function privateBytes(path:string){
 await assertTrustedPath(path,{trustedRoot:'/',kind:'file',private:true});
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const before=await fd.stat();if(before.gid!==0||before.nlink!==1||before.size>2*1024*1024)fail();const raw=await fd.readFile();const after=await fd.stat(),named=await lstat(path);if(['dev','ino','size','mtimeMs','ctimeMs'].some(k=>before[k as keyof typeof before]!==after[k as keyof typeof after])||named.ino!==before.ino||named.dev!==before.dev)fail();return raw;}finally{await fd.close();}
}
async function snapshot(path:string){
 const stat=await lstat(path);const names=(await readdir(path)).sort();return JSON.stringify([stat.dev,stat.ino,stat.uid,stat.gid,stat.mode,stat.mtimeMs,stat.ctimeMs,await Promise.all(names.map(async name=>{const s=await lstat(join(path,name));return [name,s.dev,s.ino,s.uid,s.gid,s.mode,s.mtimeMs,s.ctimeMs,s.size];}))]);
}
async function keyDirectory(path:string,required:readonly string[]){
 let present=false,ownerModeOk=false,setMatches=false,before:string|undefined;
 const values=new Map<string,string>(),safe=new Map<string,boolean>();
 try{await lstat(path);present=true;await assertTrustedPath(path,{trustedRoot:'/',kind:'directory',private:true});if((await lstat(path)).gid!==0)fail();ownerModeOk=true;before=await snapshot(path);setMatches=JSON.stringify((await readdir(path)).sort())===JSON.stringify([...required].sort());
  for(const name of required){try{const value=(await privateBytes(join(path,name))).toString('utf8').trim();if(!/^[a-f0-9]{64}$/.test(value))fail();safe.set(name,true);values.set(name,value);}catch{safe.set(name,false);}}
 }catch{}
 return {present,ownerModeOk,setMatches,before,values,safe,path};
}
export async function main(){
 if(process.platform!=='linux'||process.getuid?.()!==0||process.getgid?.()!==0||process.argv.length!==2)fail();
 execFileSync('/usr/bin/python3',['-I','-B','-c',"import os,stat,fcntl; p='/var/lib/workspacex-cn/runtime/release.lock'; assert os.readlink('/proc/self/fd/9')==p; a=os.fstat(9); b=os.lstat(p); assert stat.S_ISREG(a.st_mode) and (a.st_uid,a.st_gid,stat.S_IMODE(a.st_mode),a.st_nlink)==(0,0,0o600,1) and (a.st_dev,a.st_ino)==(b.st_dev,b.st_ino); f=open(p,'rb')\ntry: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: pass\nelse: raise RuntimeError('LOCK_NOT_HELD')"],{stdio:['ignore','ignore','ignore','ignore','ignore','ignore','ignore','ignore','ignore',9]});
 const helper='/usr/local/lib/workspacex-cn/cn_compose_baseline.py';await assertTrustedPath(helper,{trustedRoot:'/',kind:'file'});
 const capture=()=>JSON.parse(execFileSync('/usr/bin/python3',['-I','-B','-c',"import sys,json;sys.path.insert(0,'/usr/local/lib/workspacex-cn');import cn_compose_baseline as m;print(json.dumps({'baseline':m.capture(),'stableDirectory':str(m.STABLE)},sort_keys=True))"],{maxBuffer:2*1024*1024,stdio:['ignore','pipe','ignore']}).toString('utf8'));
 const start=capture(),baseline=start.baseline,runtime=baseline.baselineRuntime;
 if(baseline.schemaVersion!==2||!runtime?.startsWith('/var/lib/workspacex-cn/runtime/'))fail();
 const source=await readFile(new URL('../../../packages/cloud-deploy/src/runtime-environment.ts',import.meta.url),'utf8');
 const consumers=canonicalLiveConsumers(source),required=[...stableDeploymentSecretNames].sort();if(required.length!==12)fail();
 const stable=await keyDirectory(start.stableDirectory,required),legacy=await keyDirectory(join(runtime,'secrets'),required);
 let bootstrap:Record<string,string>={},bootstrapOwnerModeOk=false;
 try{bootstrap=parseEnvironment((await privateBytes(join(runtime,'bootstrap.env'))).toString('utf8').split('\n'));bootstrapOwnerModeOk=true;}catch{}
 const inspected=JSON.parse(execFileSync('/usr/bin/docker',['--host','unix:///var/run/docker.sock','--config','/nonexistent','inspect','workspacex-cn-api-1','workspacex-cn-agent-1'],{maxBuffer:2*1024*1024,stdio:['ignore','pipe','ignore']}).toString('utf8'));
 const environments:Record<string,Record<string,string>>={bootstrap};
 for(const [i,role] of ['api','agent'].entries()){const v=inspected[i];if(v?.State?.Running!==true||v.Image!==baseline.images[role])fail();environments[role]=parseEnvironment(v.Config.Env);}
 const rows=required.map(key=>{
  const observations=Object.entries(consumers).flatMap(([role,map])=>Object.entries(map).filter(([,name])=>name===key).map(([env])=>environments[role]?.[env]));
  return compareKey(key,stable.values.get(key),legacy.values.get(key),observations,stable.safe.get(key)===true,legacy.safe.get(key)===true);
 });
 const unchanged=JSON.stringify(start)===JSON.stringify(capture())&&(!stable.before||stable.before===await snapshot(stable.path))&&(!legacy.before||legacy.before===await snapshot(legacy.path));
 const summary={kind:'cn-stable12-readonly-diagnostic',stableDirectoryPresent:stable.present,stableDirectoryOwnerModeOk:stable.ownerModeOk,stableSetMatches:stable.setMatches,legacyDirectoryPresent:legacy.present,legacyDirectoryOwnerModeOk:legacy.ownerModeOk,bootstrapOwnerModeOk,legacyMatchedCount:rows.filter(v=>v.legacySame===true).length,liveMatchedCount:rows.filter(v=>v.liveSame===true).length,unknownCount:rows.filter(v=>v.status==='unknown').length,noMutation:unchanged,all12Proven:unchanged&&stable.ownerModeOk&&stable.setMatches&&rows.every(v=>v.legacySame===true&&(!v.liveConsumerPresent||v.liveSame===true))};
 process.stdout.write(JSON.stringify({summary,keys:rows})+'\n');if(!summary.all12Proven)process.exitCode=3;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)void main().catch(()=>{process.stderr.write('CN_STABLE12_READONLY_UNPROVEN\n');process.exitCode=3;});
