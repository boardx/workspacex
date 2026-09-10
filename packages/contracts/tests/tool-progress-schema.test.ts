import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolProgressStream } from "../src/execution-journal";
/**
 * 漂移门（#3322）：生成物一旦与 zod 契约不一致就红。没有这道门，Python 侧会拿着一份
 * 过期 schema 继续"校验通过"，而 apps/api 的 `ToolProgressStream.parse` 会当场拒收——
 * 两边各自绿，链路却断了。
 */
describe("tool progress stream schema", () => {
  it("generated artifact matches the zod contract verbatim", () => {
    const generated = JSON.parse(readFileSync(
      new URL("../../../apps/deep-agent-service/src/deep_agent_service/generated/tool_progress_schema.json", import.meta.url), "utf8"));
    expect(generated.schema).toEqual(zodToJsonSchema(ToolProgressStream, { target: "jsonSchema7", $refStrategy: "none" }));
  });
});
