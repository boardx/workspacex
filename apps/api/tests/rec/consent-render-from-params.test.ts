/**
 * F79 · 同意书文案由参数动态渲染，禁止硬编码天数（uc-5-4 R3-3 / AC2 / I-39 / E6）。
 *
 * ## 为什么不是只断言「渲染出了 180」
 *
 * 若渲染函数把天数写死成 180，对「组织默认值 = 180」这一组输入依然会通过。
 * 本文件对**一整张取值表**跑同一条链（同 F78 的纪律），并且额外验证：
 * 渲染路径与 F78 `resolveRetention` 是**同一条链**——改项目覆盖值后，
 * 新渲染立刻反映新值，而不需要任何本模块自己的「缓存失效」逻辑（因为根本没有缓存）。
 */
import { describe, expect, it } from "vitest";
import { renderConsentText } from "../../src/application/recording/consent-render";
import { consentRenderHarness } from "../support/consent-render-fakes";

const AT = "2026-07-31T00:00:00.000Z";
const TEMPLATE_ID = "consent-template-recording-v1";
const TEMPLATE_TEXT =
  "只在这场访谈中录，存于 {{dataController}} 的服务器，{{retentionDays}} 天后自动删除。" +
  "如需联系 {{contactName}}，请发邮件至 {{complianceEmail}}。";

const DAY_VALUES = [1, 7, 45, 180, 365, 1095, 4000] as const;

describe("F79 · 同意书渲染读的是参数，不是常量", () => {
  it.each(DAY_VALUES)("组织默认保留期 = %i 天时，渲染文案里出现的就是这个数", async (days) => {
    const deps = consentRenderHarness({
      retentionParams: { projectOverrideDays: null, orgDefaultDays: days, deletionGraceDays: null },
      templates: { [TEMPLATE_ID]: TEMPLATE_TEXT },
    });

    const out = await renderConsentText(deps, {
      orgId: "org-1",
      projectId: "prj-1",
      templateId: TEMPLATE_ID,
      resolvedAt: AT,
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.variables.retentionDays).toBe(days);
    expect(out.renderedText).toContain(`${days} 天后自动删除`);
    expect(out.renderedText).not.toContain("{{retentionDays}}");
  });

  it("项目级覆盖值压过组织默认值——渲染文案跟着覆盖值走", async () => {
    const deps = consentRenderHarness({
      retentionParams: { projectOverrideDays: 45, orgDefaultDays: 180, deletionGraceDays: null },
      templates: { [TEMPLATE_ID]: TEMPLATE_TEXT },
    });

    const out = await renderConsentText(deps, {
      orgId: "org-1", projectId: "prj-1", templateId: TEMPLATE_ID, resolvedAt: AT,
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.variables.retentionDays).toBe(45);
    expect(out.renderedText).toContain("45 天后自动删除");
  });

  it("改掉项目覆盖值后，新渲染立刻变化——同一条链，没有缓存副本（R8：三处呈现必须同源）", async () => {
    const deps = consentRenderHarness({
      retentionParams: { projectOverrideDays: 90, orgDefaultDays: 180, deletionGraceDays: null },
      templates: { [TEMPLATE_ID]: TEMPLATE_TEXT },
    });

    const before = await renderConsentText(deps, {
      orgId: "org-1", projectId: "prj-1", templateId: TEMPLATE_ID, resolvedAt: AT,
    });
    expect(before.ok && before.variables.retentionDays).toBe(90);

    deps.retention.params.set({ projectOverrideDays: 30 });

    const after = await renderConsentText(deps, {
      orgId: "org-1", projectId: "prj-1", templateId: TEMPLATE_ID, resolvedAt: AT,
    });
    expect(after.ok && after.variables.retentionDays).toBe(30);
    expect(after.ok && after.renderedText).toContain("30 天后自动删除");
  });

  it("四个变量全部出现在渲染结果里（数据控制方 / 联系人 / 合规邮箱 / 保留期）", async () => {
    const deps = consentRenderHarness({
      retentionParams: { projectOverrideDays: null, orgDefaultDays: 180, deletionGraceDays: null },
      templates: { [TEMPLATE_ID]: TEMPLATE_TEXT },
    });

    const out = await renderConsentText(deps, {
      orgId: "org-1", projectId: "prj-1", templateId: TEMPLATE_ID, resolvedAt: AT,
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.renderedText).toContain("远洋咨询");
    expect(out.renderedText).toContain("林可");
    expect(out.renderedText).toContain("compliance@example.com");
    expect(out.renderedText).toContain("180 天后自动删除");
  });

  it("组织默认值缺失 ⇒ RETENTION_POLICY_MISSING，不得发出授权链接（复用 F78 判据）", async () => {
    const deps = consentRenderHarness({
      retentionParams: { projectOverrideDays: null, orgDefaultDays: null, deletionGraceDays: null },
      templates: { [TEMPLATE_ID]: TEMPLATE_TEXT },
    });

    const out = await renderConsentText(deps, {
      orgId: "org-1", projectId: "prj-1", templateId: TEMPLATE_ID, resolvedAt: AT,
    });

    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toBe("RETENTION_POLICY_MISSING");
  });

  it("模板不存在 ⇒ TEMPLATE_NOT_FOUND", async () => {
    const deps = consentRenderHarness({
      retentionParams: { projectOverrideDays: null, orgDefaultDays: 180, deletionGraceDays: null },
    });

    const out = await renderConsentText(deps, {
      orgId: "org-1", projectId: "prj-1", templateId: "does-not-exist", resolvedAt: AT,
    });

    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toBe("TEMPLATE_NOT_FOUND");
  });

  it.each([
    { dataController: null },
    { contactName: null },
    { complianceEmail: null },
    { complianceEmail: "" },
  ])(
    "渲染变量缺失 %o ⇒ CONSENT_TEMPLATE_VARIABLE_MISSING，不得发出授权链接（I-39 / E6）",
    async (override) => {
      const deps = consentRenderHarness({
        retentionParams: { projectOverrideDays: null, orgDefaultDays: 180, deletionGraceDays: null },
        contact: override,
        templates: { [TEMPLATE_ID]: TEMPLATE_TEXT },
      });

      const out = await renderConsentText(deps, {
        orgId: "org-1", projectId: "prj-1", templateId: TEMPLATE_ID, resolvedAt: AT,
      });

      expect(out.ok).toBe(false);
      expect(out.ok === false && out.reason).toBe("CONSENT_TEMPLATE_VARIABLE_MISSING");
    },
  );

  it("反证：把渲染函数换成写死 180 的假实现，取值表里除 180 外的每一行都会失败", async () => {
    // 这条测试的意义是证明上面的取值表本身有区分力——不是形式主义。
    const hardcoded = (days: number) =>
      days === 180
        ? "只在这场访谈中录，180 天后自动删除。"
        : "只在这场访谈中录，180 天后自动删除。"; // 硬编码：无论传入什么天数都返回 180

    const mismatches = DAY_VALUES.filter((days) => !hardcoded(days).includes(`${days} 天`));
    expect(mismatches.length).toBe(DAY_VALUES.length - 1);
  });
});
