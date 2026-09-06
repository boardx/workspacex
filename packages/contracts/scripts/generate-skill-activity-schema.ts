import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { SkillActivityStream } from "../src/skill-activity";
import { SKILL_PACKAGE_DIGEST_ALGORITHM, canonicalSkillPackageManifest } from "../src/skill-package-manifest";
const files = ["😀.txt", "\uE000.txt", "SKILL.md", "中文.txt"].map(path=>({path,digest:"a".repeat(64)}));
const artifact = { schema: zodToJsonSchema(SkillActivityStream,{target:"jsonSchema7",$refStrategy:"none"}),
  packageDigestAlgorithm: SKILL_PACKAGE_DIGEST_ALGORITHM,
  golden: {files,canonical:canonicalSkillPackageManifest(files),sha256:createHash("sha256").update(canonicalSkillPackageManifest(files)).digest("hex")} };
const destination=fileURLToPath(new URL("../../../apps/deep-agent-service/src/deep_agent_service/generated/skill_activity_schema.json",import.meta.url));
mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,`${JSON.stringify(artifact,null,2)}\n`);
