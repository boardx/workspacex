/**
 * issue #2767 —— `call_skill` 按目标 skill 风险分级 interrupt 的跨语言门控。
 *
 * TS 网关（`deep-agent-model-provider.ts`）把本次 run 挂载集合里 L2 skill 的 stableName
 * 名单（`domain/agent-run/skill-risk-level.ts` 的 `selectL2SkillNames`）投影到 LangGraph
 * `config.configurable[KERNEL_HITL_SKILLS_CONFIGURABLE_KEY]`，Python 内核（`harness.py`
 * 的 `_call_skill_requires_hitl`）按同一个键名读它决定要不要为这次 `call_skill` 触发
 * interrupt。Python 侧没有 zod，只能写常量——本测试机械比对那个常量与契约逐字一致
 * （同 `cross-lang-interjection-parity.test.ts`/`deep-agent-hitl.test.ts` 的手法：读
 * Python 源文本，不猜），改一侧不改另一侧就会红。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { KERNEL_HITL_SKILLS_CONFIGURABLE_KEY } from "../../src/plan-permissions";
import { DEEP_AGENT_HITL_TOOL_NAME } from "../../src/deep-agent-hitl";

const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS_PY = resolve(HERE, "../../../../apps/deep-agent-service/src/deep_agent_service/harness.py");
const PROVIDER_TS = resolve(HERE, "../../../../apps/api/src/infrastructure/agent-run/deep-agent-model-provider.ts");

function readSrc(path: string): string {
  const src = readFileSync(path, "utf8");
  expect(src.length, `${path} 读到空内容——路径漂了`).toBeGreaterThan(200);
  return src;
}

function pyStringConst(src: string, name: string): string {
  const match = new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m").exec(src);
  expect(match, `harness.py 里找不到 ${name} 的定义`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("#2767 跨语言门控：harness.py 读『哪些 skill 需要 interrupt』的键名 = 契约", () => {
  const harness = readSrc(HARNESS_PY);

  it("configurable 键名：_HITL_SKILLS_CONFIG_KEY = KERNEL_HITL_SKILLS_CONFIGURABLE_KEY", () => {
    expect(pyStringConst(harness, "_HITL_SKILLS_CONFIG_KEY")).toBe(KERNEL_HITL_SKILLS_CONFIGURABLE_KEY);
  });

  it("call_skill 仍是 DEFAULT_HITL_TOOL_NAMES 之一，但 build_interrupt_on 不再对它写死 True", () => {
    expect(harness).toContain(`"${DEEP_AGENT_HITL_TOOL_NAME}"`);
    // `call_skill` 这一项改成了带 `when` 谓词的 InterruptOnConfig——真代码里不应再出现
    // `{name: True for name in DEFAULT_HITL_TOOL_NAMES}` 这种一次性把它也钉成 True 的写法
    // 之外没有覆盖分支（即：`result["call_skill"] = ` 这一行必须存在）。
    expect(harness).toMatch(/result\["call_skill"\]\s*=\s*InterruptOnConfig\(/);
  });

  it("_call_skill_requires_hitl 谓词真实存在，且被 InterruptOnConfig 的 when 引用", () => {
    expect(harness).toMatch(/def _call_skill_requires_hitl\(/);
    expect(harness).toMatch(/when=_call_skill_requires_hitl/);
  });
});

describe("#2767 TS 侧投影用的是契约常量，不是手写字符串", () => {
  it("deep-agent-model-provider.ts 从契约导入 KERNEL_HITL_SKILLS_CONFIGURABLE_KEY 并用它当键", () => {
    const provider = readSrc(PROVIDER_TS);
    expect(provider).toMatch(
      /import\s*\{\s*KERNEL_HITL_SKILLS_CONFIGURABLE_KEY\s*\}\s*from\s*"@repo\/contracts\/plan-permissions"/,
    );
    // 新建 run 与 resume 两条分支都要用计算属性名投影（同一份对象字面量写法，issue
    // #2768/PR #2777 把 resume 分支也改成显式 `config.configurable` 对象字面量），
    // 否则 resume 之后内核又会退回"每次都问"的 fail-closed 默认（见 provider 该处头注）。
    const uses = provider.match(/\[KERNEL_HITL_SKILLS_CONFIGURABLE_KEY\]:\s*input\.hitlSkillNames/g) ?? [];
    expect(uses, "新建 run 与 resume 两条分支都必须投影 hitlSkillNames").toHaveLength(2);
    // 没有人把键名再手写一遍。
    expect(provider).not.toMatch(/^\s*hitl_skill_names:\s*input\.hitlSkillNames/m);
  });
});

describe("#2767 契约本身", () => {
  it("KERNEL_HITL_SKILLS_CONFIGURABLE_KEY 的值逐字是 hitl_skill_names", () => {
    expect(KERNEL_HITL_SKILLS_CONFIGURABLE_KEY).toBe("hitl_skill_names");
  });
});
