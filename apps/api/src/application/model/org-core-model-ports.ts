import type { OrgId } from "../../domain/org-id";
import type { DatabasePort } from "../ports/database.port";
/** Server verified text-model identity. No credential or endpoint is returned. */
export interface OrgCoreModelBinding {
 readonly modelId:string;
 readonly modelProvider:string;
 readonly runtimeModelId:string;
 readonly configRevision:string;
 /** Opaque deployment binding; not a secret, URL, or caller-selected account. */
 readonly privateConnectionId:string;
}
export interface OrgCoreModelAvailability {
 /** Recheck enabled tenant pool, immutable tariff/bounds and same private SDK endpoint/account. */
 resolve(orgId:OrgId,modelId:string,actorId:string,scopedDb?:DatabasePort):Promise<OrgCoreModelBinding|null>;
}
export interface OrgCoreModelState {
 readonly version:number;
 readonly selection:OrgCoreModelBinding|null;
 readonly updatedBy:string|null;
 readonly reason:string|null;
}
export interface OrgCoreModelRepository {
 read(orgId:OrgId):Promise<OrgCoreModelState>;
 /** Store rechecks org-admin and availability inside the same transaction as optimistic CAS/audit. */
 set(orgId:OrgId,input:{expectedVersion:number;modelId:string;actorId:string;reason:string}):Promise<OrgCoreModelState>;
}
export class OrgCoreModelError extends Error {
 constructor(readonly code:"NOT_ORG_ADMIN"|"ORGANIZATION_REQUIRED"|"CORE_MODEL_UNAVAILABLE"|"VERSION_CHANGED"|"CORE_MODEL_INPUT_INVALID"){super(code);}
}
export const ORG_CORE_MODEL_REPOSITORY=Symbol("OrgCoreModelRepository");
export const ORG_CORE_MODEL_AVAILABILITY=Symbol("OrgCoreModelAvailability");
