import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { NativeSessionBindingRef, NativeSessionResolveInput, NativeSessionResolved, NATIVE_SESSION_CONFIG_KEY, NATIVE_PACKAGE_SET_ALGORITHM, canonicalNativePackageSet } from "../src/native-session-binding";
const options={target:"jsonSchema7",$refStrategy:"none"} as const;
const content=JSON.stringify({configurableKey:NATIVE_SESSION_CONFIG_KEY,packageSetAlgorithm:NATIVE_PACKAGE_SET_ALGORITHM,packageSetGolden:{input:[{stableName:"b",skillId:"技能",versionId:"v2",packageDigest:"b".repeat(64)},{stableName:"a",skillId:"s1",versionId:"v1",packageDigest:"a".repeat(64)}],canonical:canonicalNativePackageSet([{stableName:"b",skillId:"技能",versionId:"v2",packageDigest:"b".repeat(64)},{stableName:"a",skillId:"s1",versionId:"v1",packageDigest:"a".repeat(64)}])},ref:zodToJsonSchema(NativeSessionBindingRef,options),input:zodToJsonSchema(NativeSessionResolveInput,options),output:zodToJsonSchema(NativeSessionResolved,options)},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/native_session_binding_schema.json');
if(process.argv.includes('--check')) { if(readFileSync(path,'utf8')!==content)throw new Error('native session schema stale'); } else writeFileSync(path,content);
