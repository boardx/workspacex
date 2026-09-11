import { createHash } from "node:crypto";
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
vi.mock("../src/trusted-path", () => ({ assertTrustedPath: vi.fn() }));
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
it("prepares private canonical files and digests but explicitly leaves ingress installation pending",async()=>{const f=await fixture();const result=await prepareHost(f.config,f.manifest,f.options,f.services,f.source);expect(result.readyForProvision).toBe(false);expect(result.cloudVerified).toBe(false);expect(result.status).toBe("files-ready-ingress-installation-required");expect(f.calls.filter(a=>a[1]==="pull")).toHaveLength(6);expect(await readFile(join(f.options.runtimeDirectory,"ingress/private-key.pem"),"utf8")).toBe(privateKeyPem);expect((await stat(join(f.options.runtimeDirectory,"ingress/private-key.pem"))).mode&0o077).toBe(0);expect(JSON.stringify(result)).not.toContain("BEGIN PRIVATE KEY");expect(f.calls.some(a=>["systemctl","nginx","apt","yum"].includes(a[0]!))).toBe(false);});
it("replays only with matching receipt and exact file hashes",async()=>{const f=await fixture();const one=await prepareHost(f.config,f.manifest,f.options,f.services,f.source);const two=await prepareHost(f.config,f.manifest,f.options,f.services,f.source);expect(two.installationId).toBe(one.installationId);expect(f.calls.some(a=>a.includes("--replace"))).toBe(true);await writeFile(join(f.options.runtimeDirectory,"nginx.conf"),"operator change");await expect(prepareHost(f.config,f.manifest,f.options,f.services,f.source)).rejects.toThrow("PREPARE_FILE_CHANGED");expect(await readFile(join(f.options.runtimeDirectory,"nginx.conf"),"utf8")).toBe("operator change");});
it("never adopts unrelated existing runtime or data directories",async()=>{const f=await fixture();await mkdir(f.options.runtimeDirectory,{mode:0o700});await expect(prepareHost(f.config,f.manifest,f.options,f.services,f.source)).rejects.toThrow();await rm(f.options.runtimeDirectory,{recursive:true});await mkdir(f.config.environment.dataVolumePath,{mode:0o700});await writeFile(join(f.config.environment.dataVolumePath,"unrelated"),"keep");await expect(prepareHost(f.config,f.manifest,f.options,f.services,f.source)).rejects.toThrow();expect(await readFile(join(f.config.environment.dataVolumePath,"unrelated"),"utf8")).toBe("keep");});
it("does not adopt a foreign AppArmor profile even after an interrupted receipt exists",async()=>{const f=await fixture();f.setProfile("workspacex-native-sessions (enforce)\n");for(let i=0;i<2;i++)await expect(prepareHost(f.config,f.manifest,f.options,f.services,f.source)).rejects.toThrow("APPARMOR_PROFILE_ALREADY_EXISTS");expect(f.calls.some(a=>a.includes("--replace")||a.includes("--add"))).toBe(false);});
it("rejects dirty checkout and non-Linux/non-root before host mutation",async()=>{const f=await fixture();f.setDirty();await expect(prepareHost(f.config,f.manifest,f.options,f.services,f.source)).rejects.toThrow("CLEAN_RELEASE_CHECKOUT_REQUIRED");await expect(prepareHost(f.config,f.manifest,f.options,{...f.services,host:{platform:"darwin",uid:0}},f.source)).rejects.toThrow("PREPARED_ECS_ROOT_REQUIRED");expect(f.calls.some(a=>a[0]==="apparmor_parser")).toBe(false);});
it("retains shared lock when policy loading has uncertain result",async()=>{const f=await fixture();const run=async(argv:readonly string[])=>{if(argv[0]==="apparmor_parser"&&argv.includes("--add"))throw new Error("uncertain");return f.services.run(argv);};await expect(prepareHost(f.config,f.manifest,f.options,{...f.services,run},f.source)).rejects.toThrow("APPARMOR_LOAD_UNPROVEN");expect((await stat(join(f.options.runtimeDirectory,"provision.lock"))).isFile()).toBe(true);});
it("production prewarms application images and creates no local data volume",async()=>{const f=await fixture();const config=deploymentExample("production");const result=await prepareHost(config,f.manifest,f.options,f.services,f.source);expect(result.readyForProvision).toBe(false);expect(f.calls.filter(a=>a[1]==="pull")).toHaveLength(4);await expect(stat(join(f.root,"data"))).rejects.toThrow();});
it("rejects an untrusted checkout before running Git or mutating the host",async()=>{const f=await fixture();vi.mocked(assertTrustedPath).mockRejectedValueOnce(new Error("UNTRUSTED_HOST_PATH"));await expect(prepareHost(f.config,f.manifest,f.options,f.services,f.source)).rejects.toThrow("UNTRUSTED_HOST_PATH");expect(f.calls).toHaveLength(0);});

it.each(["starter","production"] as const)("%s preparation receipt proves only integrity, not ingress or cloud acceptance",async profile=>{
 const f=await fixture();const config=profile==="starter"?f.config:deploymentExample("production");
 const prepared=await prepareHost(config,f.manifest,f.options,f.services,f.source);expect(prepared.readyForProvision).toBe(false);
 f.calls.length=0;const verified=await verifyPreparedHost(config,f.manifest,f.options,f.services.run,f.source);
 expect(verified).toEqual({integrityVerified:true,installationId:prepared.installationId,ingressVerified:false,cloudVerified:false});
 expect(f.calls).toHaveLength(2);expect(f.calls.every(argv=>argv[0]==="git"&&argv.includes("show"))).toBe(true);
 expect(prepared.remainingChecks).toContain("review-and-install-runtime-nginx-conf-in-http-context");
 expect(prepared.remainingChecks).toContain("public-dns-and-matching-tls-endpoint");
});
it.each(["starter","production"] as const)("%s rejects modified security bytes even with a forged matching receipt hash",async profile=>{
 const f=await fixture(),config=profile==="starter"?f.config:deploymentExample("production");await prepareHost(config,f.manifest,f.options,f.services,f.source);
 const receiptPath=join(f.options.runtimeDirectory,"prepare-receipt.json"),receipt=JSON.parse(await readFile(receiptPath,"utf8"));
 const malicious='{"defaultAction":"SCMP_ACT_ALLOW"}';await writeFile(join(f.options.runtimeDirectory,"docker-seccomp.json"),malicious);
 receipt.files["docker-seccomp.json"]=createHash("sha256").update(malicious).digest("hex");
 receipt.specHash=createHash("sha256").update(JSON.stringify({config:deploymentConfigSchema.parse(config),manifest:validateReleaseManifest(f.manifest),options:f.options,files:receipt.files})).digest("hex");
 await writeFile(receiptPath,JSON.stringify(receipt));
 await expect(verifyPreparedHost(config,f.manifest,f.options,f.services.run,f.source)).rejects.toThrow("HOST_PREPARATION_INTEGRITY_FAILED");
 expect(await readFile(join(f.options.runtimeDirectory,"docker-seccomp.json"),"utf8")).toBe(malicious);
});
it.each(["starter","production"] as const)("%s rejects incomplete receipts and mutated ingress files",async profile=>{
 const f=await fixture(),config=profile==="starter"?f.config:deploymentExample("production");await prepareHost(config,f.manifest,f.options,f.services,f.source);
 const receiptPath=join(f.options.runtimeDirectory,"prepare-receipt.json"),receipt=JSON.parse(await readFile(receiptPath,"utf8"));
 await writeFile(receiptPath,JSON.stringify({...receipt,status:"preparing"}));await expect(verifyPreparedHost(config,f.manifest,f.options,f.services.run,f.source)).rejects.toThrow("HOST_PREPARATION_INTEGRITY_FAILED");
 await writeFile(receiptPath,JSON.stringify(receipt));await writeFile(join(f.options.runtimeDirectory,"nginx.conf"),"changed ingress");
 await expect(verifyPreparedHost(config,f.manifest,f.options,f.services.run,f.source)).rejects.toThrow("HOST_PREPARATION_INTEGRITY_FAILED");
});
it("rejects foreign Starter data marker at handoff",async()=>{const f=await fixture();await prepareHost(f.config,f.manifest,f.options,f.services,f.source);await writeFile(join(f.config.environment.dataVolumePath,".workspacex-prepare.json"),"{}");await expect(verifyPreparedHost(f.config,f.manifest,f.options,f.services.run,f.source)).rejects.toThrow("HOST_PREPARATION_INTEGRITY_FAILED");});
it.each(["starter","production"] as const)("%s requires receipt and rejects a different deployment spec",async profile=>{
 const f=await fixture(),config=profile==="starter"?f.config:deploymentExample("production");await prepareHost(config,f.manifest,f.options,f.services,f.source);
 await expect(verifyPreparedHost({...config,provision:{...config.provision,adminEmail:"different@example.com"}},f.manifest,f.options,f.services.run,f.source)).rejects.toThrow("HOST_PREPARATION_INTEGRITY_FAILED");
 await rm(join(f.options.runtimeDirectory,"prepare-receipt.json"));
 await expect(verifyPreparedHost(config,f.manifest,f.options,f.services.run,f.source)).rejects.toThrow("HOST_PREPARATION_INTEGRITY_FAILED");
});
