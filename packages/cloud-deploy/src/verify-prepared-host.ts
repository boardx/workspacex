import { lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { deploymentConfigSchema } from "./config";
import { validateReleaseManifest } from "./release";
import { resolveSecret, assertSecretOperationActive, type SecretOperationContext } from "./secrets";
import { prepareHostOptionsSchema, prepareHostReceiptSchema, hostPreparationContract, type PrepareHostOptions, type PrepareHostServices } from "./prepare-host";

/** Read-only integrity gate; this does NOT install ingress or prove real TLS/cloud readiness. */
export async function verifyPreparedHost(configInput:unknown,releaseInput:unknown,optionsInput:PrepareHostOptions,
 run:NonNullable<PrepareHostServices["run"]>,source:NodeJS.ProcessEnv=process.env,
 context:{signal:AbortSignal;remainingMs:()=>number}={signal:AbortSignal.timeout(15000),remainingMs:()=>15000}){
 try{
  assertSecretOperationActive(context);
  const config=deploymentConfigSchema.parse(configInput),manifest=validateReleaseManifest(releaseInput),options=prepareHostOptionsSchema.parse(optionsInput);
  if(config.provision.release!==manifest.release)throw new Error();
  const privateDir=async(path:string)=>{const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw new Error();};
  const dir=options.runtimeDirectory;await privateDir(dir);await privateDir(join(dir,"ingress"));
  const receipt=prepareHostReceiptSchema.parse(JSON.parse(await resolveSecret(`file:${join(dir,"prepare-receipt.json")}`,source,context)));
  if(receipt.status!=="files-ready-ingress-installation-required"||!receipt.profileManaged)throw new Error();
  const expected=await hostPreparationContract(config,manifest,options,run,source,context);
  if(receipt.specHash!==expected.specHash||JSON.stringify(receipt.files)!==JSON.stringify(expected.files))throw new Error();
  // Hash the actual private runtime files as well as the independently derived canonical
  // contract. Editing both a file and its receipt cannot authorize a noncanonical profile.
  for(const [name,digest] of Object.entries(expected.files)){
   const bytes=await resolveSecret(`file:${join(dir,name)}`,source,context);
   if(createHash("sha256").update(bytes).digest("hex")!==digest)throw new Error();
  }
  if(config.environment.profile==="starter"){
   const data=config.environment.dataVolumePath;await privateDir(data);
   const expectedOwner=JSON.stringify({installationId:receipt.installationId,specHash:receipt.specHash});
   if(await resolveSecret(`file:${join(data,".workspacex-prepare.json")}`,source,context)!==expectedOwner)throw new Error();
   for(const name of ["postgres","redis"]){const stat=await lstat(join(data,name));if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error();}
  }
  assertSecretOperationActive(context);
  return{integrityVerified:true as const,installationId:receipt.installationId,ingressVerified:false as const,cloudVerified:false as const};
 }catch{assertSecretOperationActive(context as SecretOperationContext);throw new Error("HOST_PREPARATION_INTEGRITY_FAILED");}
}
