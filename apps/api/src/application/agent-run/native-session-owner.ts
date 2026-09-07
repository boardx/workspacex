import type { z } from "zod";
import type { NativeSessionBindingRef, NativeSessionResolved } from "@repo/contracts/native-session-binding";
import type { TrustedSkillPackage } from "@repo/contracts/standard-capabilities";
import type { ExecutionAuthorityContext } from "./tool-execution-authority";
export const NATIVE_SESSION_OWNER=Symbol("NativeSessionOwner");
export type NativeBinding=z.infer<typeof NativeSessionBindingRef>;
export type NativeResolved=z.infer<typeof NativeSessionResolved>;
export type NativePins=readonly {stableName:string;package:z.infer<typeof TrustedSkillPackage>}[];
export interface NativeSessionOwner {
 provision(context:ExecutionAuthorityContext,pins:NativePins,interruptOn:Record<string,boolean>):Promise<NativeBinding>;
 resolve(bindingId:string,context:ExecutionAuthorityContext):Promise<NativeResolved>;
 releaseForRun(orgId:ExecutionAuthorityContext["orgId"],runId:string):Promise<void>;
 release(bindingId:string,orgId:ExecutionAuthorityContext['orgId'],runId:string):Promise<void>;
}
export interface NativeSessionTransport {
 create(files:readonly {path:string;contentBase64:string}[],inputs?:readonly {path:string;contentBase64:string}[]):Promise<{sessionId:string;token:string;expiresAt:number}>;
 destroy(sessionId:string,token:string):Promise<void>;
}
