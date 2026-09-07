import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { NativeToolIdentities } from "../src/native-tool-identities";
const path = resolve(import.meta.dirname, "../../../apps/deep-agent-service/src/deep_agent_service/generated/native_tool_identities.json");
const content = JSON.stringify(NativeToolIdentities, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== content) throw new Error("Native tool identities are stale");
} else writeFileSync(path, content);
