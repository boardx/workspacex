import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

describe("personal realtime ASR provider wiring", () => {
  it("uses the shared ASR_PROVIDER and removes the personal Fun-ASR dependency", () => {
    const kernel = source("kernel.module.ts");
    const main = source("main.ts");
    const controller = source("interface/controllers/recording.controller.ts");
    const gateway = source("interface/ws/personal-realtime-asr.gateway.ts");
    const combined = [kernel, main, controller, gateway].join("\n");

    expect(main).toContain("provider: app.get(ASR_PROVIDER)");
    expect(controller).toContain("@Inject(ASR_PROVIDER)");
    expect(gateway).toContain("provider:AsrProviderPort");
    expect(combined).not.toContain("PERSONAL_REALTIME_ASR_PROVIDER");
    expect(kernel).not.toContain("AliyunFunAsrProvider");
    expect(gateway).not.toContain("ALIYUN_ASR_");
  });
});
