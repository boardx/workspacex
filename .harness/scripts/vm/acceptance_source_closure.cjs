'use strict';
// Root launcher loads this verifier from profile-pinned FD bytes. It then reads
// and compiles both actual modules, never a caller boolean or sibling fallback.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const PROFILE='/etc/workspacex-cn/trusted-tool-binding.json',ROOT='/usr/local/lib/workspacex-cn';
function actualTrustedBytes(file,mode,expected){
 if(!path.isAbsolute(file)||file.split('/').includes('..'))throw Error('ACCEPTANCE_SOURCE_PATH');
 let parent=path.dirname(file);
 for(;;){const s=fs.lstatSync(parent);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))throw Error('ACCEPTANCE_SOURCE_PARENT');if(parent==='/')break;parent=path.dirname(parent);}
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const a=fs.fstatSync(fd);if(!a.isFile()||a.uid!==0||a.gid!==0||a.nlink!==1||(a.mode&0o777)!==mode||a.size>1048576)throw Error('ACCEPTANCE_SOURCE_METADATA');const raw=fs.readFileSync(fd),b=fs.fstatSync(fd);if(a.size!==b.size||a.mtimeMs!==b.mtimeMs||a.ctimeMs!==b.ctimeMs)throw Error('ACCEPTANCE_SOURCE_CHANGED');if(expected&&crypto.createHash('sha256').update(raw).digest('hex')!==expected)throw Error('ACCEPTANCE_SOURCE_HASH');return raw;}finally{fs.closeSync(fd);}
}
function loadPinnedAcceptanceClosure(){
 const profile=JSON.parse(actualTrustedBytes(PROFILE,0o600));
 if(!/^[a-f0-9]{40}$/.test(profile.toolRevision)||!profile.filesSha256)throw Error('ACCEPTANCE_SOURCE_PROFILE');
 const compile=(name,imports)=>{
  const source='.harness/scripts/vm/'+name,filename=ROOT+'/'+name,sha=profile.filesSha256[source];
  if(!/^[a-f0-9]{64}$/.test(sha))throw Error('ACCEPTANCE_SOURCE_PROFILE_HASH');
  const raw=actualTrustedBytes(filename,0o700,sha),m=new Module(filename);m.filename=filename;
  m.require=id=>{if(Object.prototype.hasOwnProperty.call(imports,id))return imports[id];if(['node:fs','node:crypto'].includes(id))return require(id);throw Error('ACCEPTANCE_SOURCE_IMPORT_FORBIDDEN');};
  m._compile(raw.toString('utf8'),filename);return m.exports;
 };
 const browser=compile('cn-maintenance-browser.cjs',{});
 if(typeof browser.run!=='function'||typeof browser.finishedRun!=='function')throw Error('ACCEPTANCE_SOURCE_EXPORTS');
 const producer=compile('acceptance_receipt_producer.cjs',{'compiled_maintenance_browser':browser});
 if(typeof producer.browserReceipt!=='function')throw Error('ACCEPTANCE_SOURCE_EXPORTS');
 return Object.freeze({browser,producer,toolRevision:profile.toolRevision});
}
module.exports={actualTrustedBytes,loadPinnedAcceptanceClosure};
