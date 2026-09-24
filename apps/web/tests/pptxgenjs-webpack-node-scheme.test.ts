import { describe, expect, it } from "vitest";

// next.config is executable ESM JavaScript and intentionally has no standalone declaration file.
// @ts-expect-error exercised here as runtime configuration, not application code
import rawNextConfig from "../next.config.mjs";

type Resource = { request: string; context?: string };
type Rewrite = (resource: Resource) => void;

/** 记下每个 NormalModuleReplacementPlugin 的匹配式与替换（字符串或函数）。 */
class RecordingPlugin {
  constructor(readonly pattern: RegExp, readonly replace: string | Rewrite) {}
}

function configure(isServer: boolean): RecordingPlugin[] {
  const config: { plugins: unknown[] } = { plugins: [] };
  const nextConfig = rawNextConfig as {
    webpack(current: typeof config, context: { webpack: { NormalModuleReplacementPlugin: typeof RecordingPlugin }; isServer: boolean }): typeof config;
  };
  return nextConfig.webpack(config, { webpack: { NormalModuleReplacementPlugin: RecordingPlugin }, isServer }).plugins as RecordingPlugin[];
}

const rewriteOf = (plugins: RecordingPlugin[]) => plugins.find((p) => p.pattern.test("node:fs") && typeof p.replace === "function");

describe("深度 S8（#3988）pptxgenjs 在浏览器构建里的 node: 请求", () => {
  it("客户端构建：只有 pptxgenjs 发出的 node:fs / node:https 去掉前缀，交给包自己的 browser 映射", () => {
    // ⭐ 反证锚点：去掉这条改写 ⇒ 这条红，而真实后果是整个 Next 构建挂在 `UnhandledSchemeError: node:fs`。
    const rewrite = rewriteOf(configure(false));
    expect(rewrite).toBeDefined();
    const from = (request: string, context: string) => { const r = { request, context }; (rewrite!.replace as Rewrite)(r); return r.request; };
    expect(from("node:fs", "/repo/node_modules/.pnpm/pptxgenjs@4.0.1/node_modules/pptxgenjs/dist")).toBe("fs");
    expect(from("node:https", "/repo/node_modules/.pnpm/pptxgenjs@4.0.1/node_modules/pptxgenjs/dist")).toBe("https");
    expect(from("node:fs", "/repo/node_modules/some-other-package/dist")).toBe("node:fs");
    expect(rewrite!.pattern.test("node:path")).toBe(false);
  });

  it("服务端构建不动：那里 node: 本来就是对的", () => {
    expect(rewriteOf(configure(true))).toBeUndefined();
  });
});
