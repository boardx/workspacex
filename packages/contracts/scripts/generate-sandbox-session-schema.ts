import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { schemas, limits, endpoints } from "../src/sandbox-session";

const destinations = [
  "../../../apps/skill-sandbox/src/generated/sandbox-session-schema.json",
  "../../../apps/deep-agent-service/src/deep_agent_service/generated/sandbox_session_schema.json",
].map((path) => resolve(dirname(fileURLToPath(import.meta.url)), path));
const artifact = { limits, endpoints, schemas: Object.fromEntries(Object.entries(schemas).map(([name, schema]) =>
  [name, zodToJsonSchema(schema, { target: "jsonSchema7", $refStrategy: "none" })])) };
for (const destination of destinations) {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(artifact, null, 2)}\n`);
}
