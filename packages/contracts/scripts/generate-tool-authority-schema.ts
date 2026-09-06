import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolExecutionCheckInput, ToolExecutionCheckOutput } from "../src/run-control";
const artifact=Object.fromEntries(Object.entries({input:ToolExecutionCheckInput,output:ToolExecutionCheckOutput})
  .map(([name,schema])=>[name,zodToJsonSchema(schema,{target:"jsonSchema7",$refStrategy:"none"})]));
const destination=fileURLToPath(new URL("../../../apps/deep-agent-service/src/deep_agent_service/generated/tool_authority_schema.json",import.meta.url));
mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,`${JSON.stringify(artifact,null,2)}\n`);
