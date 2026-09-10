/**
 * issue #3322 —— 把 `ToolProgressStream` 这**唯一一份**线格式声明投影成 Python 侧能校验的
 * JSON Schema。与 `generate-skill-activity-schema.ts` 同一条纪律：Python 不重写一份形状，
 * 它读这份生成物；漂移由 `tests/tool-progress-schema.test.ts` 机械判红。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolProgressStream } from "../src/execution-journal";
const artifact = { schema: zodToJsonSchema(ToolProgressStream, { target: "jsonSchema7", $refStrategy: "none" }) };
const destination = fileURLToPath(new URL("../../../apps/deep-agent-service/src/deep_agent_service/generated/tool_progress_schema.json", import.meta.url));
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, `${JSON.stringify(artifact, null, 2)}\n`);
