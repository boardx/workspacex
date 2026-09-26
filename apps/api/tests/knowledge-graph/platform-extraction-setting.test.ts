/**
 * 用户直接交办（2026-09-25，ad-hoc）—— 部署级抽取开关：
 *
 *   (a) `KnowledgeGraphController.extractionSetting`/`setExtractionSetting` 的 `deploymentCapable`
 *       现在是"provider 已配置 AND 部署开关打开"两者相与——四种组合逐条断言（单元级，构造
 *       controller 时给假端口，不起真应用，同 `get-thread-knowledge-api.test.ts` 的手法）。
 *   (b) `PlatformExtractionSettingController` 挂着类级 `PlatformOperatorGuard`（反证：
 *       `PlatformAccessController` 不挂——同 `platform-access.test.ts` 的手法）。
 *   (c) `PlatformExtractionSettingController` 的 GET/PUT 直接构造调用：写了就读得到新值，
 *       `providerConfigured` 全程只读，写操作动不了它。
 */
import { describe, expect, it, vi } from "vitest";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { knowledgeGraph as KG } from "@repo/contracts";
import { KnowledgeGraphController } from "../../src/interface/controllers/knowledge-graph.controller";
import { PlatformAccessController } from "../../src/interface/controllers/platform-access.controller";
import { PlatformExtractionSettingController } from "../../src/interface/controllers/platform-extraction-setting.controller";
import { PlatformOperatorGuard } from "../../src/interface/guards/platform-operator.guard";
import type { KgDeploymentExtractionSettingsPort, KgExtractionModelConfig, KgOrgExtractionSettingsPort } from "../../src/application/knowledge-graph/ports";

const principal = (userId: string) => ({ userId, orgId: "org-x" }) as never;

function orgExtractionSettings(orgEnabled: boolean): KgOrgExtractionSettingsPort {
  return { getEnabled: vi.fn().mockResolvedValue(orgEnabled), setEnabled: vi.fn() };
}

function modelConfig(enabled: boolean): KgExtractionModelConfig {
  return { enabled, provider: enabled ? "dashscope" : "", modelId: "default" };
}

function deploymentSettings(initial: boolean): KgDeploymentExtractionSettingsPort & { readonly calls: { setEnabled: unknown[][] } } {
  let value = initial;
  const calls: unknown[][] = [];
  return {
    getEnabled: vi.fn(async () => value),
    setEnabled: vi.fn(async (enabled: boolean, updatedByUserId: string) => {
      calls.push([enabled, updatedByUserId]);
      value = enabled;
      return value;
    }),
    calls: { setEnabled: calls },
  };
}

function kgController(opts: { provider: boolean; deployment: boolean; org: boolean }): KnowledgeGraphController {
  return new KnowledgeGraphController(
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    orgExtractionSettings(opts.org), modelConfig(opts.provider), deploymentSettings(opts.deployment),
  );
}

describe("KnowledgeGraphController.extractionSetting: deploymentCapable = provider 已配置 AND 部署开关打开", () => {
  it("provider 配置 + 部署开关开 + 组织开 ⇒ deploymentCapable=true", async () => {
    const ctl = kgController({ provider: true, deployment: true, org: true });
    const out = await ctl.extractionSetting(principal("u-1"));
    expect(out).toEqual({ deploymentCapable: true, orgEnabled: true });
  });

  it("provider 配置 + 部署开关关 ⇒ deploymentCapable=false（即便组织自己开了）", async () => {
    const ctl = kgController({ provider: true, deployment: false, org: true });
    const out = await ctl.extractionSetting(principal("u-1"));
    expect(out).toEqual({ deploymentCapable: false, orgEnabled: true });
  });

  it("没有 provider ⇒ deploymentCapable=false，不管部署开关是什么值", async () => {
    const ctl = kgController({ provider: false, deployment: true, org: true });
    const out = await ctl.extractionSetting(principal("u-1"));
    expect(out).toEqual({ deploymentCapable: false, orgEnabled: true });
  });

  it("没有 provider + 部署开关也关 ⇒ 仍是 deploymentCapable=false（不是两次假变成真）", async () => {
    const ctl = kgController({ provider: false, deployment: false, org: false });
    const out = await ctl.extractionSetting(principal("u-1"));
    expect(out).toEqual({ deploymentCapable: false, orgEnabled: false });
  });
});

describe("PlatformExtractionSettingController", () => {
  it("类级挂着 PlatformOperatorGuard（反证：PlatformAccessController 不挂）", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PlatformExtractionSettingController) as unknown[]).toContain(PlatformOperatorGuard);
    expect(Reflect.getMetadata(GUARDS_METADATA, PlatformAccessController)).toBeUndefined();
  });

  it("路径来自契约，GET/PUT 都是 /platform/knowledge-graph/extraction-setting", () => {
    expect(Reflect.getMetadata("path", PlatformExtractionSettingController.prototype.get)).toBe(
      KG.knowledgeGraph.getPlatformExtractionSetting.path,
    );
    expect(Reflect.getMetadata("path", PlatformExtractionSettingController.prototype.set)).toBe(
      KG.knowledgeGraph.setPlatformExtractionSetting.path,
    );
  });

  it("GET 读到现值；PUT 写完立即反映在下一次 GET 上；providerConfigured 全程只读", async () => {
    const config = modelConfig(true);
    const deployment = deploymentSettings(false);
    const ctl = new PlatformExtractionSettingController(config, deployment);

    const before = await ctl.get(principal("u-ops"));
    expect(before).toEqual({ providerConfigured: true, enabled: false });

    const written = await ctl.set(principal("u-ops"), { enabled: true });
    expect(written).toEqual({ providerConfigured: true, enabled: true });
    expect(deployment.calls.setEnabled).toEqual([[true, "u-ops"]]);

    const after = await ctl.get(principal("u-ops"));
    expect(after).toEqual({ providerConfigured: true, enabled: true });
  });

  it("没有 provider 时 GET/PUT 的 providerConfigured 一律 false，写操作动不了它", async () => {
    const config = modelConfig(false);
    const deployment = deploymentSettings(true);
    const ctl = new PlatformExtractionSettingController(config, deployment);

    const out = await ctl.set(principal("u-ops"), { enabled: false });
    expect(out).toEqual({ providerConfigured: false, enabled: false });
  });
});
