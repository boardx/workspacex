import { readFileSync } from "node:fs";
import { Ajv } from "ajv";

const artifact = JSON.parse(readFileSync(new URL("../generated/sandbox-session-schema.json", import.meta.url), "utf8"));
export const sessionLimits: Record<string, number> = artifact.limits;
const ajv = new Ajv({ strict: false });
ajv.addFormat("uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const validators = new Map(Object.entries(artifact.schemas).map(([name, schema]) => [name, ajv.compile(schema as object)]));
export function validateSessionBody(name: string, value: unknown): boolean {
  return validators.get(name)?.(value) === true;
}
