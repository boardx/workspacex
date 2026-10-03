import assert from 'node:assert/strict';
import {lstatSync,mkdirSync,writeFileSync} from 'node:fs';
import {isAbsolute,parse,resolve,sep,join} from 'node:path';

export function createPrivateEvidenceDirectory(input){
 assert(typeof input==='string'&&isAbsolute(input),'absolute evidence path required');
 const path=resolve(input),root=parse(path).root,parts=path.slice(root.length).split(sep).filter(Boolean);
 assert(input===path,'canonical evidence path required');
 assert(parts.length>0,'evidence directory cannot be a filesystem root');
 const uid=process.getuid?.();assert(Number.isInteger(uid),'physical evidence owner verification required');
 let parent=root;
 for(const part of parts.slice(0,-1)){
  parent=join(parent,part);const stat=lstatSync(parent);
  assert(stat.isDirectory()&&!stat.isSymbolicLink(),'physical evidence parent required');
  assert(stat.uid===uid||stat.uid===0,'evidence ancestor must belong to this user or root');
  assert(!(stat.mode&0o022)||(stat.mode&0o1000),'writable evidence ancestor requires sticky protection');
 }
 mkdirSync(path,{mode:0o700});
 const stat=lstatSync(path);assert(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===uid&&(stat.mode&0o077)===0,'private evidence ownership and permissions required');
 return path;
}

export function writeSafeFailure(out,phase){
 const receipt={status:'failed',requiredSuiteComplete:false,phase,code:'STICKY_SUITE_FAILURE'};
 writeFileSync(join(out,'public-failure.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
 return receipt;
}
