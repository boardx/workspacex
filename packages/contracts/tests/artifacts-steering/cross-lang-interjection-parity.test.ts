/**
 * Phase 14 后续 A（#2755，`artifacts-steering` 契约束 R3'/R12）—— 插话回灌内核的跨语言门控。
 *
 * TS 网关（`deep-agent-model-provider.ts`）把 `ModelCallInput.interjection`（契约
 * `KernelInterjection`）投影到 LangGraph `config.configurable[KERNEL_INTERJECTION_CONFIGURABLE_KEY]`，
 * Python 内核（`harness.py` 的 `InterjectionMiddleware`）按同一个键名、同一组字段名、
 * 同一份分类枚举读它。三者的唯一事实源都是这份契约；Python 侧没有 zod，只能写常量——
 * 本测试机械比对那三个常量与契约逐字一致（同 `cross-lang-tool-parity.test.ts` 的手法：
 * 读 Python 源文本，不猜），改任何一侧不改另一侧就会红。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  InterjectionClassification,
  KERNEL_INTERJECTION_CONFIGURABLE_KEY,
  KernelInterjection,
} from "../../src/artifacts-steering";

const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS_PY = resolve(HERE, "../../../../apps/deep-agent-service/src/deep_agent_service/harness.py");
const PROVIDER_TS = resolve(HERE, "../../../../apps/api/src/infrastructure/agent-run/deep-agent-model-provider.ts");

function readSrc(path: string): string {
  const src = readFileSync(path, "utf8");
  expect(src.length, `${path} 读到空内容——路径漂了`).toBeGreaterThan(200);
  return src;
}

/** 解析 Python 里 `NAME: tuple[str, ...] = ("a", "b")` 这种字符串元组常量。 */
function pyStringTuple(src: string, name: string): string[] {
  const match = new RegExp(`${name}:\\s*tuple\\[str, \\.\\.\\.\\]\\s*=\\s*\\(([\\s\\S]*?)\\)`).exec(src);
  expect(match, `harness.py 里找不到 ${name} 的定义`).not.toBeNull();
  return (match?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter((s) => s !== "");
}

function pyStringConst(src: string, name: string): string {
  const match = new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m").exec(src);
  expect(match, `harness.py 里找不到 ${name} 的定义`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("#2755 跨语言门控：harness.py 读插话的键名 / 字段名 / 分类枚举 = 契约", () => {
  const harness = readSrc(HARNESS_PY);

  it("configurable 键名：_INTERJECTION_CONFIG_KEY = KERNEL_INTERJECTION_CONFIGURABLE_KEY", () => {
    expect(pyStringConst(harness, "_INTERJECTION_CONFIG_KEY")).toBe(KERNEL_INTERJECTION_CONFIGURABLE_KEY);
  });

  it("字段名：_INTERJECTION_FIELDS = KernelInterjection 的键（逐字、含顺序）", () => {
    expect(pyStringTuple(harness, "_INTERJECTION_FIELDS")).toEqual(Object.keys(KernelInterjection.shape));
  });

  it("分类枚举：_INTERJECTION_CLASSIFICATIONS = InterjectionClassification.options（逐字、含顺序）", () => {
    expect(pyStringTuple(harness, "_INTERJECTION_CLASSIFICATIONS")).toEqual([...InterjectionClassification.options]);
  });

  it("Python 侧对每个分类值都有展示标签（枚举加值时不会静默 KeyError）", () => {
    const match = /_INTERJECTION_LABELS\s*=\s*\{([\s\S]*?)\}/.exec(harness);
    expect(match).not.toBeNull();
    for (const value of InterjectionClassification.options) {
      expect(match?.[1] ?? "", `_INTERJECTION_LABELS 缺 "${value}"`).toContain(`"${value}"`);
    }
  });
});

describe("#2755 TS 侧投影用的是契约常量，不是手写字符串", () => {
  it("deep-agent-model-provider.ts 从契约导入 KERNEL_INTERJECTION_CONFIGURABLE_KEY 并用它当键", () => {
    const provider = readSrc(PROVIDER_TS);
    expect(provider).toMatch(/import\s*\{\s*KERNEL_INTERJECTION_CONFIGURABLE_KEY\s*\}\s*from\s*"@repo\/contracts\/artifacts-steering"/);
    // 新建 run 分支用计算属性名 `[KERNEL_INTERJECTION_CONFIGURABLE_KEY]:`；resume 分支
    // 自 issue #2767 起要跟 `hitl_skill_names` 合并进同一个 `configurable` 对象，改成了
    // 先建一个 `resumeConfigurable` 再按键赋值（`resumeConfigurable[...] = ...`）——
    // 两种写法都是"从契约常量算出键名，不是手写字符串"，各自出现一次，合计两次。
    const literalUses = provider.match(/\[KERNEL_INTERJECTION_CONFIGURABLE_KEY\]:\s*input\.interjection/g) ?? [];
    const assignmentUses = provider.match(/resumeConfigurable\[KERNEL_INTERJECTION_CONFIGURABLE_KEY\]\s*=\s*input\.interjection/g) ?? [];
    expect(literalUses).toHaveLength(1);
    expect(assignmentUses).toHaveLength(1);
    // 没有人把键名再手写一遍（注释里的 `configurable.interjection` 是文档，不是代码——
    // 这里只查对象字面量键/赋值键的形态）。
    expect(provider).not.toMatch(/^\s*interjection:\s*input\.interjection/m);
  });
});

describe("#2755 契约本身", () => {
  it("KernelInterjection 是 strict 对象，且 text 拒绝空白", () => {
    const base = { interjectionId: "itj-1", text: "把第二页标题改成 X", classification: "adjustment", receivedAt: "2026-09-05T00:00:00.000Z" };
    expect(KernelInterjection.safeParse(base).success).toBe(true);
    expect(KernelInterjection.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(KernelInterjection.safeParse({ ...base, text: "   " }).success).toBe(false);
    expect(KernelInterjection.safeParse({ ...base, classification: "other" }).success).toBe(false);
  });
});
