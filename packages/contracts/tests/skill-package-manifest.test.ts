import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {zodToJsonSchema} from "zod-to-json-schema";
import {SkillActivityStream} from "../src/skill-activity";
import {canonicalSkillPackageManifest,SKILL_PACKAGE_DIGEST_ALGORITHM} from "../src/skill-package-manifest";
const generated=JSON.parse(readFileSync(new URL("../../../apps/deep-agent-service/src/deep_agent_service/generated/skill_activity_schema.json",import.meta.url),"utf8"));
it("generated schema and canonical manifest match shared source",()=>{
 expect(generated.schema).toEqual(zodToJsonSchema(SkillActivityStream,{target:"jsonSchema7",$refStrategy:"none"}));
 expect(generated.packageDigestAlgorithm).toEqual(SKILL_PACKAGE_DIGEST_ALGORITHM);
 expect(canonicalSkillPackageManifest(generated.golden.files)).toBe(generated.golden.canonical);
 expect(JSON.parse(generated.golden.canonical).map((row:string[])=>row[0])).toEqual(["SKILL.md","中文.txt","\uE000.txt","😀.txt"]);
 expect(createHash('sha256').update(generated.golden.canonical).digest('hex')).toBe(generated.golden.sha256);
});
it("rejects duplicate paths and invalid digests",()=>{
 expect(()=>canonicalSkillPackageManifest([{path:'x',digest:'x'}])).toThrow();
 const file={path:'x',digest:'a'.repeat(64)};
 expect(()=>canonicalSkillPackageManifest([file,file])).toThrow();
});
