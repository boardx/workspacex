import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_VISION_EXTRACTOR_MODEL_ID, resolveVisionCapableModelIds,
  resolveVisionExtractorModelId, VISION_CAPABLE_MODEL_IDS, VisionModelOverrideError,
} from "../../src/domain/model/vision-capable-models";
import {
  DEFAULT_VISION_MODEL_ID, readBailianVisionConfig,
} from "../../src/infrastructure/chat/bailian-vision-extractor";
import { readVisionModelIds } from "../../src/infrastructure/agent-run/model-vision-wire";

/**
 * issue #3355 —— 「哪个模型能看图」的单一事实源门控。
 *
 * 收敛前，这个事实被两处独立手写声明回答：`KERNEL_MODEL_VISION_IDS` 的默认值
 * （`model-vision-wire.ts`，`"qwen-vl-max,qwen-vl-plus"`）和 `DEFAULT_VISION_MODEL_ID`
 * （`bailian-vision-extractor.ts`，`"qwen-vl-max"`）。两份都漏了部署实际在用的
 * `qwen3.8-max`，于是用户上传的图从来没进过模型输入——而界面表现得和「模型不支持视觉」
 * 一模一样（#3346 / PR #3350）。
 *
 * 光把两处合并成一处不算完：本仓已九次「全绿但空转」。所以这里有一条**会红的结构断言**
 * ——任何人在 `apps/api/src` 里再写第二处视觉模型声明，这条立刻红并指出文件与行号。
 */

const API_SRC = fileURLToPath(new URL("../../src", import.meta.url));
const AUTHORITY = "domain/model/vision-capable-models.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** 去掉行注释与整块注释里的行——注释里可以（也应该）提到这些名字，声明才是问题。 */
function codeLines(source: string): { readonly n: number; readonly text: string }[] {
  const out: { n: number; text: string }[] = [];
  let inBlock = false;
  source.split("\n").forEach((raw, i) => {
    let text = raw;
    if (inBlock) {
      const end = text.indexOf("*/");
      if (end < 0) return;
      text = text.slice(end + 2);
      inBlock = false;
    }
    const blockStart = text.indexOf("/*");
    if (blockStart >= 0) {
      const end = text.indexOf("*/", blockStart + 2);
      if (end < 0) { inBlock = true; text = text.slice(0, blockStart); }
      else text = text.slice(0, blockStart) + text.slice(end + 2);
    }
    const line = text.indexOf("//");
    if (line >= 0) text = text.slice(0, line);
    if (text.trim() !== "") out.push({ n: i + 1, text });
  });
  return out;
}

describe("视觉模型清单：单一事实源（#3355）", () => {
  it("除权威文件外，没有第二处代码声明视觉模型 id 或读视觉模型 env", () => {
    const idPattern = new RegExp(VISION_CAPABLE_MODEL_IDS.map((id) =>
      id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
    const offenders: string[] = [];
    for (const file of walk(API_SRC)) {
      const rel = relative(API_SRC, file).replaceAll("\\", "/");
      if (rel === AUTHORITY) continue;
      for (const { n, text } of codeLines(readFileSync(file, "utf8"))) {
        // ① 代码里再读一次这两个 env = 第二处覆盖语义（含默认值）的声明。
        if (/KERNEL_MODEL_VISION_IDS|KERNEL_VISION_MODEL_ID/.test(text)) {
          offenders.push(`${rel}:${n} 读取视觉模型 env：${text.trim()}`);
          continue;
        }
        // ② 视觉上下文里出现清单中的模型 id 字面量 = 第二份清单/第二个默认值。
        //    （`KERNEL_MODEL_THINKING_DISABLE_IDS` 的默认值也含 `qwen3.8-max`，但它回答的是
        //     另一个问题、行上没有 vision——判据带上下文，才不会把无关事实误伤成重复声明。）
        if (/vision/i.test(text) && idPattern.test(text) && /["'`]/.test(text)) {
          offenders.push(`${rel}:${n} 视觉模型 id 字面量：${text.trim()}`);
        }
      }
    }
    expect(offenders, `视觉模型清单只能声明在 src/${AUTHORITY}：\n${offenders.join("\n")}`).toEqual([]);
  });

  it("权威清单包含部署实际在用的 qwen3.8-max（#3346 就栽在它不在清单里）", () => {
    expect(new Set(VISION_CAPABLE_MODEL_IDS)).toEqual(new Set([
      "qwen-vl-max", "qwen-vl-plus", "qwen-vl-ocr", "qwen3-vl-plus", "qwen3.8-max",
    ]));
  });

  it("抽取器默认模型与收敛前逐字节相同：qwen-vl-max", () => {
    expect(DEFAULT_VISION_EXTRACTOR_MODEL_ID).toBe("qwen-vl-max");
    expect(DEFAULT_VISION_MODEL_ID).toBe("qwen-vl-max");
    expect(readBailianVisionConfig({} as NodeJS.ProcessEnv).modelId).toBe("qwen-vl-max");
  });

  it("两个消费方在未配置时读到同一份清单", () => {
    expect(readVisionModelIds({} as NodeJS.ProcessEnv))
      .toEqual(resolveVisionCapableModelIds({} as NodeJS.ProcessEnv));
    expect(readVisionModelIds({} as NodeJS.ProcessEnv).has(DEFAULT_VISION_MODEL_ID)).toBe(true);
  });

  it("KERNEL_MODEL_VISION_IDS 覆盖真生效，且是整体替换而不是追加", () => {
    const ids = readVisionModelIds({ KERNEL_MODEL_VISION_IDS: " only-me , also-me " } as NodeJS.ProcessEnv);
    expect([...ids]).toEqual(["only-me", "also-me"]);
    expect(ids.has("qwen-vl-max")).toBe(false);
  });

  it("KERNEL_VISION_MODEL_ID（deprecated）设了仍然真生效，并打弃用警告", () => {
    const warnings: string[] = [];
    const id = resolveVisionExtractorModelId(
      { KERNEL_VISION_MODEL_ID: "qwen-vl-plus" } as NodeJS.ProcessEnv, (m) => warnings.push(m));
    expect(id).toBe("qwen-vl-plus");
    expect(warnings.join("\n")).toMatch(/deprecated/);
  });

  it("覆盖 env 设了却是空的 ⇒ 报错，不静默回落（「设了没反应」是本仓刚修过的形状）", () => {
    expect(() => readVisionModelIds({ KERNEL_MODEL_VISION_IDS: " , " } as NodeJS.ProcessEnv))
      .toThrow(VisionModelOverrideError);
    expect(() => readBailianVisionConfig({ KERNEL_VISION_MODEL_ID: "  " } as NodeJS.ProcessEnv))
      .toThrow(VisionModelOverrideError);
  });
});
