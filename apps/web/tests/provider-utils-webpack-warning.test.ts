import { describe, expect, it } from "vitest";

// next.config is executable ESM JavaScript and intentionally has no standalone declaration file.
// @ts-expect-error exercised here as runtime configuration, not application code
import rawNextConfig from "../next.config.mjs";

type WarningFilter = {
  readonly module?: RegExp;
  readonly message?: RegExp;
};

class StubNormalModuleReplacementPlugin {
  constructor(_resourceRegExp: RegExp, _newResource: string) {}
}

describe("#2926 provider-utils webpack warning", () => {
  it("suppresses only the known provider-utils dynamic-import warning", () => {
    const config: { plugins: unknown[]; ignoreWarnings?: WarningFilter[] } = { plugins: [] };
    const nextConfig = rawNextConfig as {
      webpack(
        current: typeof config,
        context: { webpack: { NormalModuleReplacementPlugin: typeof StubNormalModuleReplacementPlugin } },
      ): typeof config;
    };

    const configured = nextConfig.webpack(config, {
      webpack: { NormalModuleReplacementPlugin: StubNormalModuleReplacementPlugin },
    });
    const filter = configured.ignoreWarnings?.find((candidate) =>
      candidate.module?.test("/node_modules/@ai-sdk/provider-utils/dist/index.mjs"),
    );

    expect(filter).toBeDefined();
    expect(filter?.message?.test("Critical dependency: the request of a dependency is an expression")).toBe(true);
    expect(filter?.message?.test("Critical dependency: an unrelated warning")).toBe(false);
    expect(filter?.module?.test("/node_modules/@ai-sdk/provider-utils/dist/index.js")).toBe(false);
    expect(filter?.module?.test("/node_modules/other-package/dist/index.mjs")).toBe(false);
  });
});
