import { createHash } from "node:crypto";
import { dispatchCnReleaseReadiness } from "../src/cn-release-readiness-dispatch";
import { verifyPreparedHost } from "../src/verify-prepared-host";
import { deploymentConfigSchema } from "../src/config";
import { validateReleaseManifest } from "../src/release";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import { prepareHost } from "../src/prepare-host";
import { deploymentExample } from "../src/examples";
import { assertTrustedPath } from "../src/trusted-path";
import { assertTrustedTree } from "../src/trusted-tree";
vi.mock("../src/trusted-path", () => ({ assertTrustedPath: vi.fn() }));
vi.mock("../src/trusted-tree", () => ({ assertTrustedTree: vi.fn() }));
let tlsDir:string,certificatePem:string,privateKeyPem:string;
const roots:string[]=[];
beforeAll(async()=>{tlsDir=await mkdtemp(join(tmpdir(),"prepare-tls-"));execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-days","2","-subj","/CN=workspace.example.com","-addext","subjectAltName=DNS:workspace.example.com","-keyout",join(tlsDir,"key"),"-out",join(tlsDir,"cert")],{stdio:"ignore"});certificatePem=await readFile(join(tlsDir,"cert"),"utf8");privateKeyPem=await readFile(join(tlsDir,"key"),"utf8");});
afterAll(async()=>{await rm(tlsDir,{recursive:true,force:true});});afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),"prepare-host-"));roots.push(root);const config=deploymentExample("starter");config.environment.dataVolumePath=join(root,"data");
 const image={image:`registry.example/team/app@sha256:${"a".repeat(64)}`},manifest={schemaVersion:1,release:config.provision.release,sourceRevision:"b".repeat(40),platform:"linux/amd64",images:{web:image,api:image,agent:image,sandbox:image,postgres:image,redis:image}};
 const options={checkoutDirectory:join(root,"checkout"),runtimeDirectory:join(root,"runtime")};const calls:string[][]=[];let profile="",dirty=false;
 const run=async(argv:readonly string[])=>{calls.push([...argv]);if(argv.includes("rev-parse"))return manifest.sourceRevision;if(argv.includes("status"))return dirty?" M changed":"";if(argv.includes("show"))return argv.at(-1)!.endsWith(".json")?' {"defaultAction":"SCMP_ACT_ERRNO"}\n':"profile workspacex-native-sessions flags=(attach_disconnected) { file, }\n";if(argv[0]==="apparmor_parser"){if(!argv.includes("--version"))profile="workspacex-native-sessions (enforce)\n";return"";}if(argv[1]==="compose")return"2.30.0";if(argv[1]==="info")return"linux/amd64";if(argv[1]==="pull")return"";if(argv[1]==="image")return JSON.stringify([{Os:"linux",Architecture:"amd64",RepoDigests:[argv.at(-1)],Config:{Labels:{"org.opencontainers.image.revision":manifest.sourceRevision}}}]);throw new Error("unexpected");};
 const services={run,host:{platform:"linux",uid:0},readHostFile:async(file:string)=>file.endsWith("enabled")?"Y\n":profile};
 const source={WORKSPACEX_TLS_CONFIG:JSON.stringify({certificatePem,privateKeyPem})};
 return{root,config,manifest,options,services,source,calls,setProfile:(value:string)=>{profile=value;},setDirty:()=>{dirty=true;}};
}

async function dispatchFixture(){
 const f=await fixture();let builds=0;
 const bytes=Buffer.from(JSON.stringify(f.manifest));
 const input={lane:"artifact-ready" as "prepared"|"artifact-ready"|"cold",change:"normal" as "normal"|"hotfix",sourceRevision:f.manifest.sourceRevision,baselineSha256:"c".repeat(64),config:f.config,options:f.options,manifestBytes:bytes};
 const boundary={buildArtifacts:async()=>{builds++;return bytes;},readBaseline:async()=>input.baselineSha256,services:f.services,source:f.source};
 return {...f,input,boundary,bytes,builds:()=>builds};
}
it.each(["artifact-ready","cold"] as const)("%s dispatch really prepares files and pulls exactly once per image",async lane=>{
 const f=await dispatchFixture();f.input.lane=lane;if(lane==="cold")delete (f.input as any).manifestBytes;
 const result=await dispatchCnReleaseReadiness(f.input,f.boundary);
 expect(result.status).toBe("preparation-integrity-verified");expect(result.productionReady).toBe(false);
 expect(f.builds()).toBe(lane==="cold"?1:0);expect(f.calls.filter(a=>a[1]==="pull")).toHaveLength(6);
 expect(JSON.parse(await readFile(join(f.options.runtimeDirectory,"prepare-receipt.json"),"utf8")).profileManaged).toBe(true);
});
it("prepared hotfix verifies real files without build, pull or prepare replay",async()=>{
 const f=await dispatchFixture();await dispatchCnReleaseReadiness(f.input,f.boundary);f.calls.length=0;
 const input={...f.input,lane:"prepared" as const,change:"hotfix" as const,prepared:{manifestSha256:createHash("sha256").update(f.bytes).digest("hex"),baselineSha256:f.input.baselineSha256,expiresAt:new Date(Date.now()+60000).toISOString()}};
 const result=await dispatchCnReleaseReadiness(input,f.boundary);expect(result.status).toBe("preparation-integrity-verified");
 expect(f.builds()).toBe(0);expect(f.calls.filter(a=>a[1]==="pull"||a[0]==="apparmor_parser")).toHaveLength(0);
 await writeFile(join(f.options.runtimeDirectory,"nginx.conf"),"operator drift");
 await expect(dispatchCnReleaseReadiness(input,f.boundary)).rejects.toThrow("HOST_PREPARATION_INTEGRITY_FAILED");
 expect(await readFile(join(f.options.runtimeDirectory,"nginx.conf"),"utf8")).toBe("operator drift");
});
it("expired prepared returns explicit earlier phase without writes",async()=>{
 const f=await dispatchFixture();const result=await dispatchCnReleaseReadiness({...f.input,lane:"prepared",prepared:{manifestSha256:"0".repeat(64),baselineSha256:f.input.baselineSha256,expiresAt:new Date(0).toISOString()}},f.boundary);
 expect(result).toMatchObject({status:"requires-earlier-stage",next:"artifact-ready"});expect(f.calls).toHaveLength(0);expect(f.builds()).toBe(0);
});
it("baseline and artifact drift block before preparation",async()=>{
 const f=await dispatchFixture();await expect(dispatchCnReleaseReadiness(f.input,{...f.boundary,readBaseline:async()=>"d".repeat(64)})).rejects.toThrow("BASELINE_DRIFT");
 await expect(dispatchCnReleaseReadiness({...f.input,sourceRevision:"d".repeat(40)},f.boundary)).rejects.toThrow("SOURCE_DRIFT");expect(f.calls).toHaveLength(0);
});
it("unknown build result is not retried or downgraded",async()=>{
 const f=await dispatchFixture();let calls=0;await expect(dispatchCnReleaseReadiness({...f.input,lane:"cold",manifestBytes:undefined},{...f.boundary,buildArtifacts:async()=>{calls++;throw Error("unknown");}})).rejects.toThrow("unknown");expect(calls).toBe(1);expect(f.calls).toHaveLength(0);
});

it("prepared image loss blocks without downloading or fallback",async()=>{
 const f=await dispatchFixture();await dispatchCnReleaseReadiness(f.input,f.boundary);f.calls.length=0;
 const input={...f.input,lane:"prepared" as const,prepared:{manifestSha256:createHash("sha256").update(f.bytes).digest("hex"),baselineSha256:f.input.baselineSha256,expiresAt:new Date(Date.now()+60000).toISOString()}};
 const run=async(argv:readonly string[])=>{if(argv[1]==="image")throw Error("missing");return f.services.run(argv);};
 await expect(dispatchCnReleaseReadiness(input,{...f.boundary,services:{...f.services,run}})).rejects.toThrow();expect(f.builds()).toBe(0);expect(f.calls.filter(a=>a[1]==="pull")).toHaveLength(0);
});

it.each(["config","options","overlap"] as const)("cold invalid %s rejects before build or prepare",async kind=>{
 const f=await dispatchFixture();const input={...f.input,lane:"cold" as const,manifestBytes:undefined};
 if(kind==="config")input.config={} as any;
 if(kind==="options")input.options={...input.options,runtimeDirectory:"relative"};
 if(kind==="overlap")input.options={...input.options,runtimeDirectory:input.options.checkoutDirectory+"/nested"};
 await expect(dispatchCnReleaseReadiness(input,f.boundary)).rejects.toThrow();expect(f.builds()).toBe(0);expect(f.calls).toHaveLength(0);
});
