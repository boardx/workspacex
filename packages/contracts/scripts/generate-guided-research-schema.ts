import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  GuidedResearchNodeCommand,
  GuidedResearchWorkflowProjection,
} from "../src/research";

const command = zodToJsonSchema(GuidedResearchNodeCommand, {
  target: "jsonSchema7",
  $refStrategy: "none",
});
const projection = zodToJsonSchema(GuidedResearchWorkflowProjection, {
  target: "jsonSchema7",
  $refStrategy: "none",
});
const artifact = {
  $schema: "http://json-schema.org/draft-07/schema#",
  definitions: {
    GuidedResearchNodeCommand: command,
    GuidedResearchWorkflowProjection: projection,
  },
};
const destination = resolve(
  process.cwd(),
  "../../apps/deep-agent-service/src/deep_agent_service/generated/guided_research_schema.json",
);

writeFileSync(destination, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
