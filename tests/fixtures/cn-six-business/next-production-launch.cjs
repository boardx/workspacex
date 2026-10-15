'use strict';
// Same Next release build and standalone layout as deploy/aliyun/images/web.Dockerfile.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {store,resources}=require('./next-server-launch.cjs');
const web=path.resolve(__dirname,'../../../apps/web'),dist=path.join(web,'.next-chat-read-e2e');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function need(v){if(!v)throw Error('CN_NEXT_PRODUCTION_CONTRACT');}
function file(p){const st=fs.lstatSync(p);need(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&st.size<16*1024*1024);return fs.readFileSync(p);}
function binding(env,port){
 need(/^[a-f0-9]{40}$/.test(env.CN_SIX_SOURCE_COMMIT||''));
 need(env.NEXT_DIST_DIR==='.next-chat-read-e2e'&&env.NODE_ENV==='production'&&env.WORKSPACEX_RELEASE_BUILD==='1');
 need(env.NEXT_PUBLIC_API_URL===`http://127.0.0.1:${port}`&&/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(env.CHAT_READ_E2E_API_ORIGIN||'')&&/^[A-Za-z0-9_-]+$/.test(env.COPILOTKIT_V2_AGENT_ID||''));
 return {sourceCommit:env.CN_SIX_SOURCE_COMMIT,lockfileSha256:digest(file(path.join(web,'../../pnpm-lock.yaml'))),environmentSha256:digest(JSON.stringify([port,env.NEXT_PUBLIC_API_URL,env.CHAT_READ_E2E_API_ORIGIN,env.COPILOTKIT_V2_AGENT_ID,env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES,env.NODE_ENV,env.WORKSPACEX_RELEASE_BUILD]))};
}
function tree(root){
 const hash=crypto.createHash('sha256');let files=0,bytes=0;
 function walk(dir){for(const name of fs.readdirSync(dir).sort()){
  const p=path.join(dir,name),st=fs.lstatSync(p);
  if(st.isSymbolicLink()){const target=fs.realpathSync(p);need(target.startsWith(root+path.sep));hash.update(path.relative(root,p)+'\0symlink\0'+path.relative(root,target)+'\0');continue;}
  if(st.isDirectory()){walk(p);continue;}need(st.isFile()&&++files<=200000);bytes+=st.size;need(bytes<=8*1024**3);
  hash.update(path.relative(root,p)+'\0'+st.size+'\0');const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),buffer=Buffer.alloc(65536);
  try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}
 }}
 walk(root);return {sha256:hash.digest('hex'),files,bytes};
}
function artifact(){
 const runtime=path.join(dist,'standalone/apps/web');
 need(file(path.join(dist,'BUILD_ID')).equals(file(path.join(runtime,'.next-chat-read-e2e/BUILD_ID'))));
 return {buildId:file(path.join(dist,'BUILD_ID')).toString().trim(),standalone:tree(path.join(dist,'standalone'))};
}
async function main(){
 const [phase,port,...extra]=process.argv.slice(2);need(['build','start'].includes(phase)&&!extra.length&&/^\d+$/.test(port)&&Number(port)>0&&Number(port)<65536);
 need(process.env.CN_RELEASE_FULLSTACK_FIXTURE==='1'&&process.env.CN_SIX_REPORT_PATH);
 const directory=path.dirname(process.env.CN_SIX_REPORT_PATH),st=fs.lstatSync(directory);need(fs.realpathSync(directory)===directory&&st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o777)===0o700);
 const identity=binding(process.env,port);let command,args;
 if(phase==='build'){
  fs.mkdirSync(dist,{mode:0o700});const owned=fs.lstatSync(dist);
  store(directory,'next-build-intent.json',{...identity,distDevice:owned.dev,distInode:owned.ino,mode:'production-standalone',resources:resources()});
  command=process.execPath;args=[require.resolve('next/dist/bin/next',{paths:[web]}),'build'];
 }else{
  const built=JSON.parse(file(path.join(directory,'next-build.json')));need(JSON.stringify(built.identity)===JSON.stringify(identity));
  const owned=fs.lstatSync(dist);need(!owned.isSymbolicLink()&&owned.dev===built.distDevice&&owned.ino===built.distInode);
  need(JSON.stringify(artifact())===JSON.stringify(built.artifact));
  store(directory,'next-production-start.json',{identity,artifact:built.artifact,resources:resources()});
  command=process.execPath;args=[path.join(dist,'standalone/apps/web/server.js')];
 }
 const child=spawn(command,args,{cwd:phase==='build'?web:path.join(dist,'standalone/apps/web'),env:{...process.env,NODE_OPTIONS:'--max-old-space-size=3072',PORT:port,HOSTNAME:'127.0.0.1',NEXT_TELEMETRY_DISABLED:'1'},stdio:'inherit'});
 const relay=s=>{if(child.exitCode===null&&child.signalCode===null)child.kill(s);};process.on('SIGTERM',()=>relay('SIGTERM'));process.on('SIGINT',()=>relay('SIGINT'));
 child.on('error',()=>{process.exitCode=1;});
 child.on('close',(code,signal)=>{
  process.exitCode=code??(signal==='SIGKILL'?137:1);
  try{
   if(phase==='build'&&code===0&&!signal){
    const runtime=path.join(dist,'standalone/apps/web');
    fs.cpSync(path.join(web,'public'),path.join(runtime,'public'),{recursive:true,errorOnExist:true,force:false});
    fs.cpSync(path.join(dist,'static'),path.join(runtime,'.next-chat-read-e2e/static'),{recursive:true,errorOnExist:true,force:false});
    const owned=fs.lstatSync(dist);store(directory,'next-build.json',{identity,distDevice:owned.dev,distInode:owned.ino,artifact:artifact(),resources:resources()});
   }
   store(directory,`next-production-${phase}-exit.json`,{exitCode:code,signal,resources:resources()});
  }catch{process.exitCode=1;console.error('CN_NEXT_PRODUCTION_ARTIFACT_FAILED');}
 });
}
if(require.main===module)main().catch(()=>{process.exitCode=1;console.error('CN_NEXT_PRODUCTION_CONTRACT');});
module.exports={binding,tree,main};
