import { z } from "zod";
import { schemas as sandbox } from "./sandbox-session";
export const NativeSessionBindingRef = z.object({ bindingId: z.string().uuid(), profile: z.literal("native-v1"), policy: z.literal("native-v1") }).strict();
export const NativeSessionResolveInput = z.object({ orgId: z.string().min(1), runId: z.string().min(1), attemptId: z.string().min(1), leaseEpoch: z.number().int().positive() }).strict();
export const NativeSessionResolved = sandbox.created.extend({ interruptOn: z.record(z.boolean()), packageDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const NATIVE_SESSION_CONFIG_KEY = "native_runtime";
/** Hash this UTF-8 manifest with SHA256; package digest already covers every file. */
export const NATIVE_PACKAGE_SET_ALGORITHM = "v1:json-sorted-ascii-stableName-skillId-versionId-packageDigest-tuples";
export function canonicalNativePackageSet(packages: readonly { stableName:string; skillId:string; versionId:string; packageDigest:string }[]): string {
  const seen=new Set<string>();
  for(const p of packages){if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.stableName)||seen.has(p.stableName))throw new Error("invalid native package set");seen.add(p.stableName);}
  return JSON.stringify([...packages].sort((a,b)=>a.stableName<b.stableName?-1:a.stableName>b.stableName?1:0).map(p=>[p.stableName,p.skillId,p.versionId,p.packageDigest]));
}
