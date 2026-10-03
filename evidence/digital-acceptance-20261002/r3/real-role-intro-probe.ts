/** Real shared Chat adapter probe; not native tools, UI, Skills or workflow acceptance. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { ConfiguredModelProvider, readModelProviderConfig } from "../../../apps/api/src/infrastructure/agent-run/configured-model-provider";
import { buildOfficialAgentRolePack } from "../../../apps/api/src/domain/agent/official-role-packs";
import { ROLE_CONTEXT_GUIDANCE, professionalOutputGuidance } from "../../../apps/api/src/application/agent-run/role-context-guidance";

import { isContextIndependentRequest } from "../../../apps/api/src/application/agent-run/role-introduction-context";

async function main() {
  const envPath = process.env.QWEN_ACCEPTANCE_ENV_FILE;
  const outDir = process.env.QWEN_ACCEPTANCE_OUT_DIR;
  if (!envPath || !outDir) throw new Error("Specify private env and evidence output paths");
  const env = parseEnv(readFileSync(envPath, "utf8"));
  const config = readModelProviderConfig(env);
  if (!config.provider || !config.baseUrl || !config.apiKey) throw new Error("Shared Chat model configuration incomplete");
  const pack = buildOfficialAgentRolePack();
  const role = pack.agents.find((agent) => agent.stableName === "d003-product-manager")!;
  const at = new Date().toISOString();
  const modelId = "qwen3.8-max";
  const input = {
    modelProvider: config.provider,
    modelId,
    system: [role.instructions, ROLE_CONTEXT_GUIDANCE, professionalOutputGuidance(at)].join("\n\n"),
    history: [{ role: "user" as const, content: "我的方向是佛学的冥想" }],
    user: process.env.QWEN_ACCEPTANCE_INPUT_FILE ? readFileSync(process.env.QWEN_ACCEPTANCE_INPUT_FILE, "utf8") : "验收 D003：请准确介绍你的角色背景、专业方法、可用 Skills 与 workflow、产物类型和权限边界。仅依据本角色当前配置，不引用其他对话记忆；没有的能力请明确说明。先不要执行任务或调用外部系统。",
  };
  const prefix = process.env.QWEN_ACCEPTANCE_OUTPUT_PREFIX ?? "real-role-intro";
  const fixtureHistoryCount = input.history.length;
  if (isContextIndependentRequest(input.user)) input.history = [];
  const provider = new ConfiguredModelProvider(config);
  const started = performance.now();
  try {
    const result = await provider.complete(input);
    const elapsedMs = Math.round(performance.now() - started);
    const report = {
      at, modelId, roleVersion: pack.packVersion, roleDigest: role.instructionDigest,
      fixtureHistoryCount, modelHistoryCount: input.history.length, elapsedMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      checks: {
        productIdentityPresent: /产品经理|D003/.test(result.text),
        irrelevantProfileNotRepeated: !/佛学|冥想/.test(result.text),
      },
      boundary: "Real Qwen via unchanged ConfiguredModelProvider and shared Chat env; direct text-context probe only, not native tool routing, browser acceptance or verified Skills/workflow execution.",
    };
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, `${prefix}-output.md`), result.text);
    writeFileSync(resolve(outDir, `${prefix}-result.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await provider.close(); }
}
main().catch(() => { console.error("Real role introduction probe failed; no credential-bearing error text emitted."); process.exitCode = 1; });
