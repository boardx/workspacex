import {describe,it,expect} from "vitest";
import {execFileSync,spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {closeSync,mkdtempSync,openSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {CANDIDATE_COMPOSE_APP,emitCandidateComposeSource} from "../src/cn-candidate-compose-source.js";
import {createCloudCompose} from "../src/compose.js";
import {deploymentExample} from "../src/examples.js";

const root=resolve(import.meta.dirname,"../../..");
function request(){
 const config=deploymentExample("production");config.provision.release="2026.10.3-cn.1";
 const image={image:`registry.example/app/runtime@sha256:${"a".repeat(64)}`};
 return {schemaVersion:1,sourceRevision:CANDIDATE_COMPOSE_APP,config,
  manifest:{schemaVersion:1,release:config.provision.release,sourceRevision:CANDIDATE_COMPOSE_APP,platform:"linux/amd64",
   images:{web:image,api:image,agent:image,sandbox:image,postgres:image,redis:image}},
  options:{projectName:"cn-candidate-local",runtimeDirectory:"/etc/workspacex-cn/candidate-local"}};
}
describe("fixed APP native compose source",()=>{
 it("reuses the native renderer including the native external runtime network",()=>{
  const input=request(),actual=emitCandidateComposeSource(input);
  expect(actual).toEqual({...createCloudCompose(input.config,input.manifest,input.options),
   networks:{default:{external:true,name:"cn-candidate-local-runtime"}}});
  expect(Object.keys(actual.services).sort()).toEqual(["agent","api","sandbox","sandbox-sessions","web"]);
  expect(actual.services.api).toMatchObject({ports:["127.0.0.1:3200:3200"],environment:{KERNEL_DEEP_AGENT_BASE_URL:"http://agent:8000"}});
  for(const name of ["sandbox","sandbox-sessions"])expect(actual.services[name]).toMatchObject({network_mode:"none",read_only:true});
 });
 it("preserves the existing authoritative serverless RDS no-TLS configuration",()=>{
  const input=request();input.config.environment.rdsTlsException={kind:"aliyun-postgresql-serverless-no-tls",allowedCidrs:["10.0.0.0/24"]};
  expect(emitCandidateComposeSource(input).services.api).toBeDefined();
 });
 it.each(["unknown-field","wrong-source","wrong-platform","wrong-release","starter","unsafe-runtime","unknown-option","model-secret-value"])("rejects %s",scenario=>{
  const input:any=request();
  if(scenario==="unknown-field")input.command="docker";
  if(scenario==="wrong-source")input.manifest.sourceRevision="b".repeat(40);
  if(scenario==="wrong-platform")input.manifest.platform="linux/arm64";
  if(scenario==="wrong-release")input.manifest.release="2026.10.4-cn.1";
  if(scenario==="starter")input.config=deploymentExample("starter");
  if(scenario==="unsafe-runtime")input.options.runtimeDirectory="/etc/workspacex-cn/../production";
  if(scenario==="unknown-option")input.options.network="host";
  if(scenario==="model-secret-value")input.config.provision.modelProfile.apiKeySecretRef="secret-inline";
  expect(()=>emitCandidateComposeSource(input)).toThrow();
 });
 it("bundles locally with pinned APP blobs and executes the standalone CLI through an inherited FD",()=>{
  const dir=mkdtempSync(join(tmpdir(),"cn-compose-bundle-")),bundle=join(dir,"compose.cjs");
  try{
   execFileSync(process.execPath,[resolve(root,".harness/scripts/vm/build-cn-candidate-compose-source.mjs"),bundle],{cwd:root});
   const raw=readFileSync(bundle),closure=JSON.parse(readFileSync(bundle+".source-closure.json","utf8"));
   expect(closure.bundleSha256).toBe(createHash("sha256").update(raw).digest("hex"));
   expect(closure.sources["packages/cloud-deploy/src/compose.ts"].gitBlob).toBe("d9dc2c92e756009e1c8ce0f5bfcc97fb5344a982");
   expect(Object.keys(closure.dependencies).length).toBeGreaterThan(0);
   const fd=openSync(bundle,"r");
   try{
    const result=spawnSync(process.execPath,["/proc/self/fd/3"],{input:JSON.stringify(request()),encoding:"utf8",stdio:["pipe","pipe","pipe",fd]});
    expect(result.status).toBe(0);expect(result.stderr).toBe("");expect(JSON.parse(result.stdout)).toEqual(emitCandidateComposeSource(request()));
   }finally{closeSync(fd);}
   for(const [args,input]of [[[],"{secret-inline"],[["--module","untrusted"],JSON.stringify(request())],[[],"x".repeat(1024*1024+1)]] as const){
    const result=spawnSync(process.execPath,[bundle,...args],{input,encoding:"utf8"});
    expect(result.status).toBe(1);expect(result.stdout).toBe("");expect(result.stderr).toBe("CANDIDATE_COMPOSE_REJECTED\n");
   }
   expect(()=>execFileSync(process.execPath,[resolve(root,".harness/scripts/vm/build-cn-candidate-compose-source.mjs"),bundle],{cwd:root,stdio:"pipe"})).toThrow();
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
});
