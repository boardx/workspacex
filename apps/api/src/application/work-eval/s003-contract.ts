/** S003 runtime compatibility exports and JSON Schema generation from the contract single source. */
import { S003InputSchema, S003OutputShapeSchema } from "@repo/contracts/work-skill-evidence-ledger";
import { zodToJsonSchema } from "zod-to-json-schema";
export { S003InputSchema, S003OutputSchema } from "@repo/contracts/work-skill-evidence-ledger";

export const s003MachineSchemas = {
  inputSchema: zodToJsonSchema(S003InputSchema, { $refStrategy: "none" }),
  outputSchema: {
    ...zodToJsonSchema(S003OutputShapeSchema, { $refStrategy: "none" }),
    allOf: [{
      if: { properties: { queryType: { const: "who-knows" } }, required: ["queryType"] },
      then: { properties: { items: { items: { properties: { hits: { items: { required: ["owner"] } } } } } } },
    }],
  },
};
