import { readFile, writeFile } from "node:fs/promises";
import { zodToJsonSchema } from "zod-to-json-schema";
import { deploymentInputSchema } from "./config";

const path = new URL("../../../deploy/aliyun/parameters.schema.json", import.meta.url);
const schema = zodToJsonSchema(deploymentInputSchema, {
  name: "DeploymentInput", $refStrategy: "none", target: "jsonSchema7",
});
const content = `${JSON.stringify({ ...schema,
  description: "Starter and production deployment configuration. Also run runtime validation for OSS region consistency and separate database role references. Structural validity is NOT cloud readiness.",
}, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = await readFile(path, "utf8").catch(() => "");
  if (current !== content) { process.stderr.write("Generated deployment schema is stale. Run pnpm --filter @repo/cloud-deploy schema.\n"); process.exitCode = 1; }
} else await writeFile(path, content);
