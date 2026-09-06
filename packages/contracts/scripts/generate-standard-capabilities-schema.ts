import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { standardCapabilitiesSchema } from "./standard-capabilities-schema";

// Structural schema is generated; byte totals, uniqueness and digest validation
// remain runtime checks because JSON Schema cannot express those invariants.
const destination = resolve(import.meta.dirname, "../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_capabilities_schema.json");
if (process.argv.includes("--check")) {
  if (readFileSync(destination, "utf8") !== standardCapabilitiesSchema()) throw new Error("generated standard capability schema is stale");
} else writeFileSync(destination, standardCapabilitiesSchema());
