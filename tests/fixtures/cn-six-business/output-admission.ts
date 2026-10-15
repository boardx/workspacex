/** Fresh coordinator admission, then identity-bound Playwright worker reload. */
import {lstatSync,fstatSync,openSync,writeFileSync,readFileSync,closeSync,fsyncSync,constants} from 'node:fs';
import {dirname,resolve} from 'node:path';
interface Policy {prefix:string;owners:readonly number[]}
const productionPolicy:Policy={prefix:'/var/lib/',owners:[0]};
function need(v:unknown,code:string):asserts v{if(!v)throw Error(code);}
function exists(path:string){try{lstatSync(path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
export function admitOutputs(report:string,output:string,worker:string|undefined,policy:Policy=productionPolicy){
 need(report!==output&&!report.startsWith(output+'/')&&!output.startsWith(report+'/'),'OUTPUT_PATH_OVERLAP');
 need(dirname(report)===dirname(output),'ONE_PRIVATE_OUTPUT_PARENT');
 const parent=dirname(report),claim=parent+'/.six-output-admission.json';
 for(const path of [report,output]){
  need(path.startsWith(policy.prefix)&&resolve(path)===path,'PRIVATE_OUTPUT_PATH_REQUIRED');
  for(let dir=dirname(path);;dir=dirname(dir)){
   const st=lstatSync(dir);need(st.isDirectory()&&!st.isSymbolicLink()&&policy.owners.includes(st.uid)&&!(st.mode&0o022),'PRIVATE_OUTPUT_PARENT_REQUIRED');
   if(dir===parent)need((st.mode&0o777)===0o700,'PRIVATE_OUTPUT_OWNER_MODE');
   if(dir==='/')break;
  }
 }
 const st=lstatSync(parent),identity={kind:'cn-six-output-admission-v1',report,output,parentDevice:st.dev,parentInode:st.ino};
 if(worker===undefined){
  // A stale claim or output from any earlier invocation is never reused.
  need(!exists(report)&&!exists(output),'NEW_PRIVATE_OUTPUT_REQUIRED');
  const fd=openSync(claim,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,JSON.stringify(identity));fsyncSync(fd);}finally{closeSync(fd);}
  const dir=openSync(parent,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(dir);}finally{closeSync(dir);}
 }else{
  need(/^[0-9]+$/.test(worker),'PLAYWRIGHT_WORKER_ID_REQUIRED');
  const info=lstatSync(claim);need(info.isFile()&&!info.isSymbolicLink()&&policy.owners.includes(info.uid)&&(info.mode&0o777)===0o600&&info.nlink===1&&info.size<=8192,'PRIVATE_OUTPUT_ADMISSION_REQUIRED');
  const fd=openSync(claim,constants.O_RDONLY|constants.O_NOFOLLOW);let admitted;
  try{const opened=fstatSync(fd);need(opened.ino===info.ino&&opened.dev===info.dev&&opened.size<=8192,'OUTPUT_ADMISSION_CHANGED');admitted=JSON.parse(readFileSync(fd,'utf8'));}finally{closeSync(fd);}
  need(JSON.stringify(admitted)===JSON.stringify(identity),'OUTPUT_ADMISSION_CHANGED');
  for(const [path,directory]of [[report,false],[output,true]]as const){
   if(!exists(path))continue;
   const observed=lstatSync(path);need(!observed.isSymbolicLink()&&policy.owners.includes(observed.uid)&&!(observed.mode&0o022)&&(directory?observed.isDirectory():observed.isFile()&&observed.nlink===1),'PRIVATE_OUTPUT_CHANGED');
  }
 }
 return identity;
}
