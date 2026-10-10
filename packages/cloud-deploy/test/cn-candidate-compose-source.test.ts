import {describe,it,expect} from "vitest";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {execFileSync,spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {createRequire} from "node:module";
import vm from "node:vm";
import {resolve,join} from "node:path";
import {CANDIDATE_COMPOSE_APP,emitCandidateComposeSource} from "../src/cn-candidate-compose-source.js";
import {createCloudCompose} from "../src/compose.js";
import {deploymentExample} from "../src/examples.js";
import {originalAuthorityFixture} from "../src/cn-maintenance-host/source_plan_authority_test_fixture.js";
const root=resolve(import.meta.dirname,"../../.."),APP="5285bef9a6c91bbb9857ede42779aafa64b98f32",CURRENT_BASELINE="a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0",tool="b".repeat(40),BASE="ba6343199f3c834d6a198f83d0c771614292c82b";
function request(source=CANDIDATE_COMPOSE_APP,release="2026.10.3-cn.1"){
 const config=deploymentExample("production");config.provision.release=release;
 const image={image:`registry.example/app/runtime@sha256:${"a".repeat(64)}`};
 return {schemaVersion:1,sourceRevision:source,config,manifest:{schemaVersion:1,release,sourceRevision:source,platform:"linux/amd64",images:{web:image,api:image,agent:image,sandbox:image,postgres:image,redis:image}},options:{projectName:"cn-candidate-local",runtimeDirectory:"/etc/workspacex-cn/candidate-local"}};
}
function authority(source=CANDIDATE_COMPOSE_APP){return originalAuthorityFixture({sourceRevision:source,baselineRevision:source===CANDIDATE_COMPOSE_APP?BASE:CURRENT_BASELINE,migrationPlanSha256:"a".repeat(64),attemptId:"compose"},tool);}
describe("independently approved native Compose source",()=>{
 it.each([CANDIDATE_COMPOSE_APP,APP])("reuses exact native renderer for %s",source=>{
  const input=request(source),f=authority(source),actual=emitCandidateComposeSource(input,f.authority,input.manifest);
  expect(actual).toEqual({...createCloudCompose(input.config,input.manifest,input.options),networks:{default:{external:true,name:"cn-candidate-local-runtime"}}});
  expect(Object.keys(actual.services).sort()).toEqual(["agent","api","sandbox","sandbox-sessions","web"]);
  for(const name of ["sandbox","sandbox-sessions"])expect(actual.services[name]).toMatchObject({network_mode:"none",read_only:true});
 });
 it("accepts independent approved new release without a historical release literal",()=>{const input=request(APP,"2026.10.6-cn.1"),f=authority(APP);expect(emitCandidateComposeSource(input,f.authority,input.manifest).services.api).toBeDefined();});
 it.each(["unknown-field","wrong-source","wrong-platform","wrong-release","starter","unsafe-runtime","unknown-option","model-secret-value","wrong-raw","fake-authority","wrong-tool","candidate-closure"])("rejects %s",scenario=>{
  const input:any=request(APP),approved=structuredClone(input.manifest),f=authority(APP);let a:any=f.authority;
  if(scenario==="unknown-field")input.command="docker";
  if(scenario==="wrong-source")input.sourceRevision=CANDIDATE_COMPOSE_APP;
  if(scenario==="wrong-platform")input.manifest.platform="linux/arm64";
  if(scenario==="wrong-release")input.manifest.release="2026.10.4-cn.1";
  if(scenario==="starter")input.config=deploymentExample("starter");
  if(scenario==="unsafe-runtime")input.options.runtimeDirectory="/etc/workspacex-cn/../production";
  if(scenario==="unknown-option")input.options.network="host";
  if(scenario==="model-secret-value")input.config.provision.modelProfile.apiKeySecretRef="secret-inline";
  if(scenario==="wrong-raw")f.setRaw(Buffer.from("{}"));
  if(scenario==="fake-authority")a=structuredClone(a);
  if(scenario==="wrong-tool")f.profile.toolRevision="c".repeat(40);
  if(scenario==="candidate-closure")input.manifest.images.api.image=`registry.example/app/runtime@sha256:${"c".repeat(64)}`;
  expect(()=>emitCandidateComposeSource(input,a,approved)).toThrow();
 });
 it("generator ignores Git environment redirection and rejects native drift through an admitted identity fixture",()=>{
  const dir=mkdtempSync(join(tmpdir(),"wsx-compose-git-fixture-"));
  try{
   const repo=join(dir,"candidate");mkdirSync(join(repo,"packages/cloud-deploy/src"),{recursive:true});
   for(const name of ["compose.ts","config.ts","storage-config.ts","release.ts","image-reference.ts","runtime-bundle.ts"])writeFileSync(join(repo,"packages/cloud-deploy/src",name),"fixture native drift\n");
   const env={...process.env};for(const key of Object.keys(env))if(key.startsWith("GIT_"))delete env[key];
   const git=(...args:string[])=>execFileSync("git",["-C",repo,...args],{env,encoding:"utf8"});
   git("init","--quiet");git("add","packages");git("-c","user.name=fixture","-c","user.email=fixture@example.invalid","-c","core.hooksPath=/dev/null","commit","--quiet","-m","fixture");const fixtureCommit=git("rev-parse","HEAD").trim(),source=APP;
   const original=join(dir,"original.json"),manifest=join(dir,"manifest.json"),output=join(dir,"compose.cjs");
   writeFileSync(original,JSON.stringify({schemaVersion:1,mode:"maintenance-all-writer-fence",productionActionsAuthorized:true,runtimeSessionBootstrapAuthorized:true,identity:{sourceRevision:source,baselineRevision:CURRENT_BASELINE,migrationPlanSha256:"a".repeat(64),attemptId:"fixture"},toolRevision:tool}));writeFileSync(manifest,JSON.stringify({sourceRevision:source,release:"2026.10.6-cn.1",platform:"linux/amd64"}));
   const sha=(path:string)=>createHash("sha256").update(readFileSync(path)).digest("hex");
   // Only alias the admitted SHA at the subprocess boundary. All Git reads still run
   // against the real fixture repo with the builder's environment and arguments.
   const adapter=join(dir,"fixture-git-alias.mjs");
   writeFileSync(adapter,`import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const original=cp.execFileSync;
cp.execFileSync=function(command,args,options){
 if(command==='git'&&args[args.indexOf('-C')+1]===${JSON.stringify(repo)}){
  const requested=${JSON.stringify(source)},fixture=${JSON.stringify(fixtureCommit)};
  const mapped=args.map(arg=>arg===requested+'^{commit}'?fixture+'^{commit}':arg.startsWith(requested+':')?fixture+arg.slice(requested.length):arg);
  const result=original.call(this,command,mapped,options);
  if(args.includes('rev-parse')&&args.includes(requested+'^{commit}')){
   if(String(result).trim()!==fixture)throw Error('FIXTURE_COMMIT_MISMATCH');
   return requested+'\\n';
  }
  return result;
 }
 return original.call(this,command,args,options);
};
syncBuiltinESMExports();
`);
   const result=spawnSync(process.execPath,["--import",adapter,resolve(root,".harness/scripts/vm/build-cn-candidate-compose-source.mjs"),output,original,sha(original),manifest,sha(manifest),repo],{cwd:root,encoding:"utf8",env:{...env,GIT_DIR:join(dir,"missing.git"),GIT_WORK_TREE:dir,GIT_CONFIG_COUNT:"1",GIT_CONFIG_KEY_0:"core.fsmonitor",GIT_CONFIG_VALUE_0:"untrusted"}});
   expect(result.status).not.toBe(0);expect(result.stderr).toContain("CANDIDATE_COMPOSE_NATIVE_SOURCE_DRIFT");
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it("executes actual memory-compiled CLI and shared authority instance with mocked private reads",async()=>{
  const require=createRequire(resolve(root,"apps/desktop/package.json")),esbuild=require("esbuild");
  const result=await esbuild.build({absWorkingDir:root,entryPoints:["packages/cloud-deploy/src/cn-candidate-compose-source-cli.ts"],bundle:true,platform:"node",format:"cjs",target:"node22",write:false,logLevel:"silent",plugins:[{name:"mock-protected-read-only",setup(build:any){build.onLoad({filter:/cn-maintenance-host\/fixed_transport\.ts$/},({path}:{path:string})=>({loader:"ts",contents:readFileSync(path,"utf8").replace(/export function protectedPrivateBytes\([\s\S]*?(?=export function protectedPrivateJson)/,'export function protectedPrivateBytes(path:string,pin?:string):Buffer{return (globalThis as any).__privateRead(path,pin);}\n')}));}}]});
  const compiled=result.outputFiles[0].text;
  for(const mode of ["valid","missing-original","wrong-raw","wrong-source","wrong-tool","wrong-release","wrong-entry","wrong-sourcehash"]){
   const input=request(APP),f=authority(APP),files=new Map<string,Buffer>();
   const add=(path:string,value:any)=>{const raw=Buffer.from(JSON.stringify(value));files.set(path,raw);return{path,sha256:createHash("sha256").update(raw).digest("hex")};};
   files.set(f.host.writerPlanPath,Buffer.from(JSON.stringify(f.authority.sourcePlan)+"\n"));
   const recovery=`/etc/workspacex-cn/maintenance-recovery/${APP}/compose/recovery-plan.json`,rsha="d".repeat(64);
   const entry=add("/etc/workspacex-cn/compose-entry.json",{schemaVersion:1,productionActionsAuthorized:true,identity:f.host.identity,host:f.host,production:{identity:f.host.identity,toolRevision:tool,recoveryPreflight:{planPath:recovery,planSha256:rsha,command:{path:"/usr/local/lib/workspacex-cn/cn-production-recovery-executor.py"}}},recoveryPlanPath:recovery,recoveryPlanSha256:rsha,consumerInputsPath:`/etc/workspacex-cn/maintenance-host/${APP}/compose/consumer-inputs.json`,consumerInputsSha256:rsha});
   const manifestRef=add("/etc/workspacex-cn/compose-manifest.json",input.manifest),configRef=add("/etc/workspacex-cn/compose-config.json",input.config),optionsRef=add("/etc/workspacex-cn/compose-options.json",{...input.options,manifestRef});
   const profile=structuredClone(f.profile);profile.candidateComposeEmitter={schemaVersion:2,originalEntryPlanRef:entry,optionsRef,configRef};
   if(mode==="missing-original")delete profile.originalWriterPlan;
   if(mode==="wrong-raw")files.set(f.host.writerPlanPath,Buffer.from("{}"));
   if(mode==="wrong-source")input.sourceRevision=CANDIDATE_COMPOSE_APP;
   if(mode==="wrong-tool")profile.toolRevision="c".repeat(40);
   if(mode==="wrong-release")input.manifest.release="2026.10.9-cn.1";
   if(mode==="wrong-entry")profile.candidateComposeEmitter.originalEntryPlanRef.sha256="0".repeat(64);
   if(mode==="wrong-sourcehash")profile.filesSha256[".harness/scripts/vm/maintenance_source_operations.py"]="0".repeat(64);
   add("/etc/workspacex-cn/trusted-tool-binding.json",profile);
   const output:string[]=[];const processMock={env:{},platform:"linux",getuid:()=>0,stdin:(async function*(){yield Buffer.from(JSON.stringify(input));})(),stdout:{write:(x:string)=>output.push(x)},argv:[],stderr:{write:()=>{}}};
   const context:any={Buffer,TextEncoder,TextDecoder,URL,console,process:processMock,module:{exports:{}},exports:{},require,__privateRead:(path:string,pin?:string)=>{const raw=files.get(path);if(!raw||pin&&createHash("sha256").update(raw).digest("hex")!==pin)throw Error("MOCK_PRIVATE_PIN");return raw;}};context.exports=context.module.exports;
   vm.runInNewContext(compiled,context,{timeout:5000});const main=context.module.exports.candidateComposeMain;
   if(mode==="valid"){await main([]);expect(JSON.parse(output.join(""))).toEqual(emitCandidateComposeSource(input,authority(APP).authority,input.manifest));}
   else{await expect(main([])).rejects.toThrow();expect(output).toEqual([]);}
  }
 });
});
