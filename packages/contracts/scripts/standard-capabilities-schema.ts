import { zodToJsonSchema } from "zod-to-json-schema";
import { MEMORY_SCOPE_CONFIG_KEY, TrustedMemoryScope, EXECUTION_MODE_CONFIG_KEY, SKILL_PACKAGE_LIMITS, TrustedSkillPackage } from "../src/standard-capabilities";

export function standardCapabilitiesSchema(): string {
  return `${JSON.stringify({
    configurableKeys: { executionMode: EXECUTION_MODE_CONFIG_KEY, memoryScope: MEMORY_SCOPE_CONFIG_KEY },
    memoryScope: zodToJsonSchema(TrustedMemoryScope, { target: "jsonSchema7", $refStrategy: "none" }),
    limits: SKILL_PACKAGE_LIMITS,
    package: zodToJsonSchema(TrustedSkillPackage, { target: "jsonSchema7", $refStrategy: "none", pipeStrategy: "all" }),
  }, null, 2)}\n`;
}
