// Install beside cn_restore_objects.cjs at .harness/scripts/vm.
import { createRequire } from 'node:module';
import { objectStoreConfig } from '../../../apps/api/src/infrastructure/storage/object-store-config';
import { namespace } from '../../../apps/api/src/infrastructure/storage/oss-object-store';
import { createRawOssSdkClient } from '../../../apps/api/src/infrastructure/storage/oss-sdk-client';
export type ProtectedObject = { bucket:string; namespace:string; key:string; versionId:string|null; bytes:number; sha256:string };
const { audit, validateTuple } = createRequire(import.meta.url)('./cn_restore_objects.cjs') as {
 validateTuple:(config:{bucket:string;prefix:string},tuple:ProtectedObject,keyOf:(key:string)=>string)=>string;
 audit:(sdk:unknown,config:{bucket:string;prefix:string},tuple:ProtectedObject,keyOf:(key:string)=>string)=>Promise<unknown>
};
export async function auditProtectedObject(tuple:ProtectedObject, env:NodeJS.ProcessEnv=process.env):Promise<unknown> {
 const config=objectStoreConfig(env);
 if(config.backend!=='oss'||config.oss.authMode!=='ecs-role')throw Error('OBJECT_ECS_ROLE_REQUIRED');
 const prefix=config.oss.prefix.replace(/\/$/,'');
 // Validate protected tuple/config/key before any credential or OSS network access.
 if(config.oss.bucket!==tuple.bucket||prefix!==tuple.namespace)throw Error('OBJECT_CONFIG_BINDING');
 const resolver=namespace(prefix);resolver(tuple.key);
 return auditWithSdkFactory(()=>createRawOssSdkClient(config.oss,env),{bucket:config.oss.bucket,prefix},tuple);
}

/** Protocol-test seam; production entry above always creates canonical ECS-role SDK. */
export function auditWithSdk(sdk:unknown,config:{bucket:string;prefix:string},tuple:ProtectedObject):Promise<unknown>{
 return audit(sdk,config,tuple,namespace(config.prefix));
}

/** Test seam; validates before credential/client creation. */
export async function auditWithSdkFactory(factory:()=>Promise<unknown>,config:{bucket:string;prefix:string},tuple:ProtectedObject):Promise<unknown>{
 validateTuple(config,tuple,namespace(config.prefix));
 return auditWithSdk(await factory(),config,tuple);
}
