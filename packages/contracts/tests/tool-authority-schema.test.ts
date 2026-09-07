import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {zodToJsonSchema} from "zod-to-json-schema";
import {ToolExecutionCheckInput,ToolExecutionCheckOutput} from "../src/run-control";
it("Python tool authority schema is generated from peer contract",()=>{
 const generated=JSON.parse(readFileSync(new URL("../../../apps/deep-agent-service/src/deep_agent_service/generated/tool_authority_schema.json",import.meta.url),"utf8"));
 expect(generated).toEqual(Object.fromEntries(Object.entries({input:ToolExecutionCheckInput,output:ToolExecutionCheckOutput})
 .map(([name,schema])=>[name,zodToJsonSchema(schema,{target:"jsonSchema7",$refStrategy:"none"})])));
});
