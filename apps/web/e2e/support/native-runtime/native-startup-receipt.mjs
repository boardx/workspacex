import assert from 'node:assert/strict';
import {lstatSync,openSync,writeFileSync,fsyncSync,closeSync,linkSync,unlinkSync,readFileSync,existsSync,realpathSync,fstatSync,constants} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';

const phases=new Set(['BOOTSTRAP','SOURCE','IMPORT','PREFLIGHT','TOOLCHAIN','PLAN','INITDB','POSTGRES','DATABASE','CONFIG','MIGRATE','SEED','ROLE','BUILD','API','STORAGE','WEB','IDENTITY']);
const identityCodes=new Set(['IDENTITY_SOURCE','IDENTITY_CWD','IDENTITY_LISTENER','IDENTITY_ANCESTRY']);
const codes=new Set(['ERR_ASSERTION','MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND','ENOENT','EACCES','EPERM','ENOSPC','ENOTDIR','EADDRINUSE','ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOBUFS','ERR_CHILD_PROCESS_STDIO_MAXBUFFER','TYPE_ERROR','UNKNOWN',...identityCodes]);

export function identityOperation(code,operation,identityCwd,identityListener){
  assert(identityCodes.has(code));
  try{return operation();}catch(cause){
    if(cause instanceof Error&&identityCodes.has(Object.getOwnPropertyDescriptor(cause,'code')?.value))throw cause;
    const error=new Error(code,{cause});error.code=code;
    try{if(identityCwd)error.identityCwd=parseIdentityCwd(identityCwd);}catch{ /* Invalid diagnostics must not replace the original identity failure. */ }
    try{if(identityListener)error.identityListener=parseIdentityListener(identityListener);}catch{ /* Diagnostics must not replace identity failure. */ }
    throw error;
  }
}

export function parseIdentityCwd(value){
  assert(value&&typeof value==='object'&&!Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(),['childExitCode','childSignal','commandExit','pathEqual','pathPresent','pidAlive','service']);
  assert(value.service==='web'||value.service==='api');
  assert(value.pidAlive===null||typeof value.pidAlive==='boolean');
  for(const key of ['pathPresent','pathEqual'])assert.equal(typeof value[key],'boolean');
  for(const key of ['commandExit','childExitCode'])assert(value[key]===null||(Number.isInteger(value[key])&&value[key]>=-1&&value[key]<=255));
  assert(value.childSignal===null||['SIGTERM','SIGKILL','SIGINT','SIGHUP','SIGABRT','SIGSEGV'].includes(value.childSignal));
  return{...value};
}

export function parseIdentityListener(value){
  assert(value&&typeof value==='object'&&!Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(),['ancestryVerified','childExitCode','childSignal','commandExit','listenerCount','pidAlive','service']);
  assert(value.service==='web'||value.service==='api');
  for(const key of ['pidAlive','ancestryVerified'])assert(value[key]===null||typeof value[key]==='boolean');
  assert(value.listenerCount===null||(Number.isInteger(value.listenerCount)&&value.listenerCount>=0&&value.listenerCount<=4096));
  for(const key of ['commandExit','childExitCode'])assert(value[key]===null||(Number.isInteger(value[key])&&value[key]>=-1&&value[key]<=255));
  assert(value.childSignal===null||['SIGTERM','SIGKILL','SIGINT','SIGHUP','SIGABRT','SIGSEGV'].includes(value.childSignal));
  return{...value};
}

export function safeStartupCode(error){
  try{if(codes.has(error?.code))return error.code;if(error instanceof TypeError)return 'TYPE_ERROR';}catch{ /* Error accessors must not escape the whitelist. */ }
  return 'UNKNOWN';
}

export function parseStartupReceipt(value){
  assert(value&&typeof value==='object'&&!Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(),['code','phase','sourceHead','status',...(Object.hasOwn(value,'identityCwd')?['identityCwd']:[]),...(Object.hasOwn(value,'identityListener')?['identityListener']:[])].sort());
  assert(phases.has(value.phase)&&codes.has(value.code));assert.equal(value.status,'failed');
  assert(value.sourceHead===null||(typeof value.sourceHead==='string'&&/^[a-f0-9]{40}$/.test(value.sourceHead)));
  if(value.sourceHead===null)assert(value.phase==='BOOTSTRAP'||value.phase==='SOURCE');
  const receipt={phase:value.phase,code:value.code,status:'failed',sourceHead:value.sourceHead};
  if(Object.hasOwn(value,'identityCwd')){assert(value.phase==='IDENTITY'&&value.code==='IDENTITY_CWD');receipt.identityCwd=parseIdentityCwd(value.identityCwd);}
  if(Object.hasOwn(value,'identityListener')){assert(value.phase==='IDENTITY'&&['IDENTITY_LISTENER','IDENTITY_ANCESTRY'].includes(value.code));receipt.identityListener=parseIdentityListener(value.identityListener);}
  return receipt;
}

function assertPrivateDirectory(data){
  assert(data&&resolve(data)===data&&realpathSync(data)===data);
  const directory=lstatSync(data);assert(directory.isDirectory()&&!directory.isSymbolicLink()&&directory.uid===process.getuid()&&(directory.mode&0o777)===0o700);
  let parent=dirname(data);const systemTemporaryRoot=realpathSync(tmpdir());
  while(parent!==dirname(parent)&&parent!==systemTemporaryRoot){
    const ancestor=lstatSync(parent);assert(ancestor.isDirectory()&&!ancestor.isSymbolicLink());
    if(ancestor.uid!==process.getuid()||(ancestor.mode&0o1000)){
      assert((ancestor.mode&0o022)===0||(ancestor.mode&0o1000));break;
    }
    assert.equal(ancestor.mode&0o777,0o700,'Owned runtime ancestors must remain private');parent=dirname(parent);
  }
  return directory;
}

export function writeStartupFailure({data,phase,sourceHead,error,identityCwd,identityListener}){
  const receipt=parseStartupReceipt({phase,code:safeStartupCode(error),status:'failed',sourceHead,...(identityCwd?{identityCwd}:{}),...(identityListener?{identityListener}:{})});
  assertPrivateDirectory(data);
  const target=join(data,'native-startup-failure.json');assert(!existsSync(target),'Existing startup failure evidence must be retained');
  const temporary=join(data,`.native-startup-${randomUUID()}.json`),fd=openSync(temporary,'wx',0o600);
  try{writeFileSync(fd,JSON.stringify(receipt));fsyncSync(fd);}finally{closeSync(fd);}
  linkSync(temporary,target);unlinkSync(temporary);
  return receipt;
}

export function readStartupFailure(data){
  const directory=assertPrivateDirectory(data),path=join(data,'native-startup-failure.json'),before=lstatSync(path);
  assert(before.isFile()&&!before.isSymbolicLink());assert(Number.isInteger(constants.O_NOFOLLOW)&&constants.O_NOFOLLOW>0);
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const stat=fstatSync(fd);assert(stat.isFile()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o600);
    assert(stat.size>0&&stat.size<1024);assert.equal(stat.dev,before.dev);assert.equal(stat.ino,before.ino);
    const afterDirectory=assertPrivateDirectory(data);assert.equal(afterDirectory.dev,directory.dev);assert.equal(afterDirectory.ino,directory.ino);
    const bytes=readFileSync(fd,'utf8'),after=fstatSync(fd);assert.equal(after.size,stat.size);assert.equal(after.mtimeMs,stat.mtimeMs);
    return parseStartupReceipt(JSON.parse(bytes));
  }finally{closeSync(fd);}
}
