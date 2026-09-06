import { zodToJsonSchema } from "zod-to-json-schema";
import { SKILL_PACKAGE_LIMITS, TrustedSkillPackage } from "../src/standard-capabilities";

export function standardCapabilitiesSchema(): string {
  return `${JSON.stringify({
    limits: SKILL_PACKAGE_LIMITS,
    package: zodToJsonSchema(TrustedSkillPackage, { target: "jsonSchema7", $refStrategy: "none", pipeStrategy: "all" }),
  }, null, 2)}\n`;
}
