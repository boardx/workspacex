import { parseBackupTarget } from "../../../packages/cloud-deploy/src/backup-target";
import { createOssSdkClient } from "../src/infrastructure/storage/oss-sdk-client";
import { OssObjectStore, type OssClientPort } from "../src/infrastructure/storage/oss-object-store";

/** Exported bridge is tested against the actual SDK-over-HTTP fixture. */
export function privateBackupStore(client:OssClientPort,bucket:string,prefix:string) {
  return new OssObjectStore({...client,put:(key,bytes,options)=>client.put(key,bytes,{...options,
    headers:{...options.headers,"x-oss-object-acl":"private"}})},bucket,prefix);
}
export async function createBackupStore(raw:string,env:NodeJS.ProcessEnv=process.env) {
  const target=parseBackupTarget(raw);
  return privateBackupStore(await createOssSdkClient(target,env),target.bucket,target.prefix);
}
