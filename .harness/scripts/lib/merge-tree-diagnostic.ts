/** Keep Git stdout separate from stderr; emit fixed diagnostic fields only. */
import {spawnSync} from "node:child_process";
import {accessSync,constants} from "node:fs";
import {resolve} from "node:path";
const knownErrors=["EACCES","ENOENT","ENOBUFS","ETIMEDOUT","EPERM"] as const;
export function mergeTreeSummary(result:{status:number|null;signal:string|null;stdout:string;stderr:string;error?:{code?:string}}){
 const text=result.stderr.toLowerCase(),kinds:string[]=[];
 for(const [kind,pattern] of [
  ["IDENTITY_REQUIRED",/identity unknown|unable to auto-detect email|empty ident name/],
  ["OBJECT_PERMISSION",/permission denied|read-only file system|insufficient permission|unable to create.*file/],
  ["OBJECT_MISSING",/bad object|invalid object|missing blob|unable to read tree|could not read/],
  ["REPOSITORY_CONTEXT",/not a git repository|dubious ownership|safe\.directory/],
  ["NO_COMMON_HISTORY",/unrelated histories/],["INVALID_OPTION",/unknown option|unrecognized option/],
  ["NO_SPACE",/no space left|disk quota/],["CONFLICT",/conflict/]
 ] as const)if(pattern.test(text))kinds.push(kind);
 return {exitCode:result.status,signal:result.signal&&["SIGTERM","SIGKILL","SIGABRT"].includes(result.signal)?result.signal:null,
  spawnError:knownErrors.includes(result.error?.code as typeof knownErrors[number])?result.error!.code:null,
  stdoutBytes:Buffer.byteLength(result.stdout),stderrBytes:Buffer.byteLength(result.stderr),
  stderrKinds:kinds.length?kinds:result.status!==0?["UNCLASSIFIED"]:[]};
}
export function runMergeTreeDiagnostic(repo:string,parent:string,source:string){
 if(![parent,source].every(x=>/^[a-f0-9]{40}$/.test(x)))throw new Error("MERGE_TREE_INPUT");
 const call=(args:string[])=>spawnSync("git",args,{cwd:repo,encoding:"utf8",maxBuffer:200*1024*1024});
 const result=call(["merge-tree","--write-tree","--no-messages",parent,source]);
 const objectPath=call(["rev-parse","--git-path","objects"]);
 let objectsWritable=false;
 if(objectPath.status===0)try{accessSync(resolve(repo,objectPath.stdout.trim()),constants.W_OK);objectsWritable=true;}catch{/* Boolean only. */}
 const ident=(kind:string)=>call(["var",kind]).status===0;
 const context=call(["rev-parse","--is-inside-work-tree"]);
 const summary={kind:"git-merge-tree-diagnostic-v1",...mergeTreeSummary({
  status:result.status,signal:result.signal,stdout:result.stdout??"",stderr:result.stderr??"",error:result.error as {code?:string}|undefined}),
  cwdIsGitWorktree:context.status===0&&context.stdout.trim()==="true",objectsWritable,
  authorIdentityAvailable:ident("GIT_AUTHOR_IDENT"),committerIdentityAvailable:ident("GIT_COMMITTER_IDENT"),
  overrideNamesPresent:["GIT_DIR","GIT_WORK_TREE","GIT_INDEX_FILE","GIT_OBJECT_DIRECTORY","GIT_ALTERNATE_OBJECT_DIRECTORIES","GIT_CONFIG_COUNT","GIT_CONFIG_SYSTEM","GIT_CONFIG_GLOBAL"]
   .filter(name=>typeof process.env[name]==="string")};
 console.error("MERGE_TREE_DIAGNOSTIC "+JSON.stringify(summary));
 // Same command/cwd/environment and nonzero rejection; no identity, config or permission repair.
 return {code:result.status??1,out:result.stdout??""};
}
