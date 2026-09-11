import { createHash, randomUUID, X509Certificate, createPrivateKey } from "node:crypto";
import { mkdir, open, lstat, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { deploymentConfigSchema } from "./config";
import { validateReleaseManifest, prewarmRelease } from "./release";
import { resolveSecret } from "./secrets";
import { createCloudNginxConfig } from "./nginx";
import { captureProvisionCommand } from "./command";
import { assertTrustedPath } from "./trusted-path";
import { assertTrustedTree } from "./trusted-tree";
const path=z.string().regex(/^\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/);
export const prepareHostOptionsSchema=z.object({checkoutDirectory:path,runtimeDirectory:path}).strict();
export type PrepareHostOptions=z.infer<typeof prepareHostOptionsSchema>;
type Context={signal:AbortSignal;remainingMs:()=>number};
export interface PrepareHostServices {
 run?:(argv:readonly string[],context:Context)=>Promise<string>;
 readHostFile?:(path:string)=>Promise<string>;
 host?:{platform:string;uid:number};
}
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export const prepareHostReceiptSchema=z.object({schemaVersion:z.literal(1),installationId:z.string().uuid(),specHash:z.string().regex(/^[a-f0-9]{64}$/),files:z.record(z.string().regex(/^[a-f0-9]{64}$/)),status:z.enum(["preparing","files-ready-ingress-installation-required"]),cloudVerified:z.literal(false),profileManaged:z.boolean(),releaseTreeVerified:z.literal(true)}).strict();
export const appArmorInstallationOwnerSchema=z.object({schemaVersion:z.literal(1),installationId:z.string().uuid(),profile:z.literal("workspacex-native-sessions")}).strict();
export const appArmorInstallationOwnerPath=(runtimeDirectory:string)=>join(dirname(runtimeDirectory),".workspacex-apparmor-owner.json");
async function syncDir(dir:string){const file=await open(dir,"r");try{await file.sync();}finally{await file.close();}}
async function privateDir(dir:string){await assertTrustedPath(dir,{trustedRoot:"/",kind:"directory",private:true});}
async function trustedSecretReference(reference:string){if(reference.startsWith("file:"))await assertTrustedPath(reference.slice(5),{trustedRoot:"/",kind:"file",private:true});}
async function newPrivateFile(path:string,value:string){const file=await open(path,"wx",0o600);try{await file.writeFile(value);await file.sync();}finally{await file.close();}}
async function existing(path:string){try{return await lstat(path);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error;}}

/** Shared, read-only derivation used by prepare and provision. Canonical security bytes
 * come from the immutable Git object, never from mutable runtime files or the receipt. */
export async function hostPreparationContract(config: z.infer<typeof deploymentConfigSchema>, manifest: ReturnType<typeof validateReleaseManifest>, options: PrepareHostOptions,
 run: NonNullable<PrepareHostServices["run"]>, source: NodeJS.ProcessEnv, context: Context) {
 const dir=options.runtimeDirectory,checkout=options.checkoutDirectory,environment=config.environment;
 const canonical=async(file:string)=>run(["git","-C",checkout,"show",`${manifest.sourceRevision}:${file}`],context);
 const seccomp=await canonical("apps/skill-sandbox/security/docker-seccomp.json"),apparmor=await canonical("apps/skill-sandbox/security/docker-apparmor-sessions");
 JSON.parse(seccomp);
 if(!apparmor.includes("profile workspacex-native-sessions "))throw new Error("INVALID_CANONICAL_APPARMOR_PROFILE");
 const url=new URL(environment.publicUrl);if(url.port&&url.port!=="443")throw new Error("INGRESS_PORT_443_REQUIRED");
 const tls=z.object({certificatePem:z.string().min(1),privateKeyPem:z.string().min(1)}).strict().parse(JSON.parse(await resolveSecret(environment.tlsSecretRef,source,context)));
 const blocks=tls.certificatePem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
 if(!blocks?.length||tls.certificatePem.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,"").trim())throw new Error("TLS_SECRET_INVALID");
 const leaf=blocks.map(pem=>new X509Certificate(pem))[0]!;
 if(!leaf.checkPrivateKey(createPrivateKey(tls.privateKeyPem))||!leaf.checkHost(url.hostname,{subject:"never"})||Date.parse(leaf.validFrom)>Date.now()||Date.parse(leaf.validTo)<=Date.now())throw new Error("TLS_SECRET_INVALID");
 const contents:Record<string,string>={"docker-seccomp.json":seccomp,"docker-apparmor-sessions":apparmor,"ingress/fullchain.pem":tls.certificatePem,"ingress/private-key.pem":tls.privateKeyPem,
  "nginx.conf":createCloudNginxConfig({domain:url.hostname,certificateFile:join(dir,"ingress/fullchain.pem"),certificateKeyFile:join(dir,"ingress/private-key.pem")})};
 const files=Object.fromEntries(Object.entries(contents).map(([name,value])=>[name,hash(value)]));
 const specHash=hash(JSON.stringify({config,manifest,options,files}));
 return {contents,files,specHash};
}

/** Explicit prepared-ECS action; never invoked by provision. Existing unrelated paths,
 * profiles and software are not adopted. Receipt/hash matching permits safe replay.
 */
export async function prepareHost(configInput:unknown,releaseInput:unknown,optionsInput:PrepareHostOptions,
 services:PrepareHostServices={},source:NodeJS.ProcessEnv=process.env){
 const config=deploymentConfigSchema.parse(configInput),manifest=validateReleaseManifest(releaseInput),options=prepareHostOptionsSchema.parse(optionsInput);
 const host=services.host??{platform:process.platform,uid:process.getuid?.()??-1};
 if(host.platform!=="linux"||host.uid!==0)throw new Error("PREPARED_ECS_ROOT_REQUIRED");
 if(Number(process.versions.node.split(".")[0])<22)throw new Error("NODE_22_REQUIRED");
 if(config.provision.release!==manifest.release)throw new Error("RELEASE_VERSION_MISMATCH");
 const dir=options.runtimeDirectory,checkout=options.checkoutDirectory,environment=config.environment;
 if(dir===checkout||dir.startsWith(`${checkout}/`)||checkout.startsWith(`${dir}/`))throw new Error("PREPARE_DIRECTORIES_OVERLAP");
 if(environment.profile==="starter"&&(dir===environment.dataVolumePath||dir.startsWith(`${environment.dataVolumePath}/`)||environment.dataVolumePath.startsWith(`${dir}/`)))throw new Error("PREPARE_DIRECTORIES_OVERLAP");
 const deadline=Date.now()+3600000,context={signal:AbortSignal.timeout(3600000),remainingMs:()=>Math.max(0,deadline-Date.now())};
 const run=services.run??((argv:readonly string[],ctx:Context)=>captureProvisionCommand({executable:argv[0]!,args:argv.slice(1),cwd:checkout,env:source},ctx));
 const hostRead=services.readHostFile??((file:string)=>readFile(file,"utf8"));
 const active=()=>{if(context.signal.aborted||context.remainingMs()<=0)throw new Error("HOST_PREPARE_CANCELLED");};
 await assertTrustedPath(checkout,{trustedRoot:"/",kind:"directory"});
 await assertTrustedTree(checkout,{signal:context.signal,remainingMs:context.remainingMs});
 await assertTrustedPath(dirname(dir),{trustedRoot:"/",kind:"directory"});
 if(environment.profile==="starter")await assertTrustedPath(dirname(environment.dataVolumePath),{trustedRoot:"/",kind:"directory"});
 await trustedSecretReference(environment.tlsSecretRef);
 const revision=(await run(["git","-C",checkout,"rev-parse","HEAD"],context)).trim();
 if(revision!==manifest.sourceRevision||(await run(["git","-C",checkout,"status","--porcelain"],context)).trim())throw new Error("CLEAN_RELEASE_CHECKOUT_REQUIRED");
 const compose=/^v?(\d+)\.(\d+)\.(\d+)/.exec((await run(["docker","compose","version","--short"],context)).trim());
 if(!compose||Number(compose[1])<2||Number(compose[1])===2&&Number(compose[2])<30)throw new Error("COMPOSE_2_30_REQUIRED");
 const platform=(await run(["docker","info","--format","{{.OSType}}/{{.Architecture}}"],context)).trim().replace("aarch64","arm64").replace("x86_64","amd64");
 if(platform!==manifest.platform)throw new Error("TARGET_PLATFORM_MISMATCH");
 await run(["apparmor_parser","--version"],context);
 if((await hostRead("/sys/module/apparmor/parameters/enabled")).trim()!=="Y")throw new Error("APPARMOR_REQUIRED");
 const {contents,files,specHash}=await hostPreparationContract(config,manifest,options,run,source,context);
 const ownerPath=appArmorInstallationOwnerPath(dir),ownerStat=await existing(ownerPath);
 const owner=ownerStat?(await assertTrustedPath(ownerPath,{trustedRoot:"/",kind:"file",private:true}),appArmorInstallationOwnerSchema.parse(JSON.parse(await resolveSecret(`file:${ownerPath}`,source,context)))):undefined;
 const receiptPath=join(dir,"prepare-receipt.json");let receipt:z.infer<typeof prepareHostReceiptSchema>;const wasExisting=!!(await existing(dir));
 if(wasExisting){await privateDir(dir);receipt=prepareHostReceiptSchema.parse(JSON.parse(await resolveSecret(`file:${receiptPath}`,source,context)));if(receipt.specHash!==specHash||JSON.stringify(receipt.files)!==JSON.stringify(files))throw new Error("PREPARE_RECEIPT_MISMATCH");if(owner&&owner.installationId!==receipt.installationId)throw new Error("APPARMOR_INSTALLATION_MISMATCH");}
 else{active();await mkdir(dir,{mode:0o700});await privateDir(dir);receipt={schemaVersion:1,installationId:owner?.installationId??randomUUID(),specHash,files,status:"preparing",cloudVerified:false,profileManaged:false,releaseTreeVerified:true};await newPrivateFile(receiptPath,JSON.stringify(receipt));await syncDir(dir);}
 const lock=await open(join(dir,"provision.lock"),"wx",0o600);let releaseLock=true;
 try{
  await lock.writeFile(JSON.stringify({operation:"prepare-host",installationId:receipt.installationId,pid:process.pid}));await lock.sync();await syncDir(dir);
  const ensureDir=async(directory:string)=>{if(await existing(directory)){await privateDir(directory);return;}active();await mkdir(directory,{mode:0o700});await privateDir(directory);};
  const profiles=await hostRead("/sys/kernel/security/apparmor/profiles"),hasProfile=profiles.split("\n").some(line=>line.startsWith("workspacex-native-sessions "));
  if(hasProfile&&!owner)throw new Error("APPARMOR_PROFILE_ALREADY_EXISTS");
  if(owner&&owner.installationId!==receipt.installationId)throw new Error("APPARMOR_INSTALLATION_MISMATCH");
  if(!owner){await newPrivateFile(ownerPath,JSON.stringify({schemaVersion:1,installationId:receipt.installationId,profile:"workspacex-native-sessions"}));await syncDir(dirname(dir));}
  // Receipt owns only these exact files. Never replace a mismatched file on replay.
  await ensureDir(join(dir,"ingress"));
  for(const [name,value] of Object.entries(contents)){
   const file=join(dir,name);if(await existing(file)){if(hash(await resolveSecret(`file:${file}`,source,context))!==files[name])throw new Error("PREPARE_FILE_CHANGED");}
   else{active();await newPrivateFile(file,value);}await assertTrustedPath(file,{trustedRoot:"/",kind:"file",private:true});
  }
  await syncDir(join(dir,"ingress"));await syncDir(dir);
  if(environment.profile==="starter"){
   const data=environment.dataVolumePath,marker=join(data,".workspacex-prepare.json"),ownership=JSON.stringify({installationId:receipt.installationId,specHash});
   if(await existing(data)){await privateDir(data);if(await resolveSecret(`file:${marker}`,source,context)!==ownership)throw new Error("DATA_DIRECTORY_NOT_OWNED");}
   else{active();await mkdir(data,{mode:0o700});await privateDir(data);await newPrivateFile(marker,ownership);await syncDir(data);}
   for(const child of ["postgres","redis"]){const target=join(data,child);if(await existing(target)){const stat=await lstat(target);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error("UNSAFE_DATA_DIRECTORY");}else await mkdir(target,{mode:0o700});}
   await syncDir(data);
  }
  active();
  try{await run(["apparmor_parser",hasProfile?"--replace":"--add",join(dir,"docker-apparmor-sessions")],context);}catch{releaseLock=false;throw new Error("APPARMOR_LOAD_UNPROVEN");}
  if(!(await hostRead("/sys/kernel/security/apparmor/profiles")).split("\n").includes("workspacex-native-sessions (enforce)")){releaseLock=false;throw new Error("APPARMOR_ENFORCEMENT_UNPROVEN");}
  receipt.profileManaged=true;
  const saveReceipt=async()=>{const temp=join(dir,`.receipt-${randomUUID()}.tmp`);await newPrivateFile(temp,JSON.stringify(receipt));await rename(temp,receiptPath);await syncDir(dir);};
  await saveReceipt();
  await prewarmRelease(manifest,environment.profile,argv=>run(argv,context));active();
  receipt.status="files-ready-ingress-installation-required";
  await saveReceipt();
  return{...receipt,readyForProvision:false as const,remainingChecks:["review-and-install-runtime-nginx-conf-in-http-context","nginx-config-test-and-targeted-ingress-reload","public-dns-and-matching-tls-endpoint","provision-ecs-role-and-dependency-preflight"]};
 }finally{await lock.close();if(releaseLock){await unlink(join(dir,"provision.lock"));await syncDir(dir);}}
}
