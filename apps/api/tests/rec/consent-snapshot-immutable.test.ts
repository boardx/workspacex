/**
 * F79 · 已提交的同意书渲染快照不可回溯改写（uc-5-4 R3-3 / AC2 / I-38）。
 *
 * 三条不许松的：
 * 1. **未提交不得固化**（`CONSENT_NOT_SUBMITTED`）——固化的前提是受访者已经提交。
 * 2. **固化是一次性的**——已固化的 `consentId` 再次固化一律 `CONSENT_SNAPSHOT_IMMUTABLE`，
 *    不比较新旧内容是否相同（同 F78 `EXPIRY_ALREADY_FROZEN` 的纪律）。
 * 3. **改参数不追溯已固化快照**——项目覆盖值改变后，重新渲染会给出新文案，
 *    但已固化的快照（`getConsentSnapshot`）三个字段（`renderedText` / `variables` / `contentHash`）
 *    保持不变，这是本 feature 的核心 AC。
 */
import { describe, expect, it } from "vitest";
import {
  freezeConsentSnapshot,
  getConsentSnapshot,
  renderConsentText,
  verifyConsentSnapshotIntegrity,
} from "../../src/application/recording/consent-render";
import { consentRenderHarness } from "../support/consent-render-fakes";

const AT = "2026-07-31T00:00:00.000Z";
const SUBMITTED_AT = "2026-07-31T00:10:00.000Z";
const TEMPLATE_ID = "consent-template-recording-v1";
const TEMPLATE_TEXT =
  "只在这场访谈中录，存于 {{dataController}} 的服务器，{{retentionDays}} 天后自动删除。";

describe("F79 · 已提交同意书的渲染快照不可回溯改写", () => {
  it("未提交时固化 ⇒ CONSENT_NOT_SUBMITTED", async () => {
    const deps = consentRenderHarness({
      retentionParams: { projectOverrideDays: null, orgDefaultDays: 180, deletionGraceDays: null },
      templates: { [TEMPLATE_ID]: TEMPLATE_TEXT },
    });

    const rendered = await renderConsentText(deps, {
      orgId: "org-1", projectId: "prj-1", templateId: TEMPLATE_ID, resolvedAt: AT,
    });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;

    const frozen = await freezeConsentSnapshot(deps, {
      consentId: "consent-1",
      templateId: TEMPLATE_ID,
      renderedText: rendered.renderedText,
      variables: rendered.variables,
      submittedAt: SUBMITTED_AT,
    });

    expect(frozen.ok).toBe(false);
    expect(frozen.ok === false && frozen.reason).toBe("CONSENT_NOT_SUBMITTED");
  });

  it("提交后固化成功，且能按 consentId 查回同一份快照", async () => {
    const deps = consentRenderHarness({
      retentionParams: { projectOverrideDays: null, orgDefaultDays: 180, deletionGraceDays: null },
      templates: { [TEMPLATE_ID]: TEMPLATE_TEXT },
    });
    deps.submissions.markSubmitted("consent-1");

    const rendered = await renderConsentText(deps, {
      orgId: "org-1", projectId: "prj-1", templateId: TEMPLATE_ID, resolvedAt: AT,
    });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;

    const frozen = await freezeConsentSnapshot(deps, {
      consentId: "consent-1",
      templateId: TEMPLATE_ID,
      renderedText: rendered.renderedText,
      variables: rendered.variables,
      submittedAt: SUBMITTED_AT,
    });
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    expect(frozen.submittedAt).toBe(SUBMITTED_AT);

    const snapshot = await getConsentSnapshot(deps, "consent-1");
    expect(snapshot).toBeDefined();
    expect(snapshot?.renderedText).toBe(rendered.renderedText);
    expect(snapshot?.contentHash).toBe(frozen.contentHash);
    expect(snapshot && verifyConsentSnapshotIntegrity(snapshot)).toBe(true);
  });

  it("二次固化同一 consentId ⇒ CONSENT_SNAPSHOT_IMMUTABLE，即使新内容与旧内容完全相同", async () => {
    const deps = consentRenderHarness({
      retentionParams: { projectOverrideDays: null, orgDefaultDays: 180, deletionGraceDays: null },
      templates: { [TEMPLATE_ID]: TEMPLATE_TEXT },
    });
    deps.submissions.markSubmitted("consent-1");

    const rendered = await renderConsentText(deps, {
      orgId: "org-1", projectId: "prj-1", templateId: TEMPLATE_ID, resolvedAt: AT,
    });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;

    const first = await freezeConsentSnapshot(deps, {
      consentId: "consent-1", templateId: TEMPLATE_ID,
      renderedText: rendered.renderedText, variables: rendered.variables,
      submittedAt: SUBMITTED_AT,
    });
    expect(first.ok).toBe(true);

    // 第二次固化——内容逐字相同，依然必须被拒绝：固化过一次就不许再固化。
    const second = await freezeConsentSnapshot(deps, {
      consentId: "consent-1", templateId: TEMPLATE_ID,
      renderedText: rendered.renderedText, variables: rendered.variables,
      submittedAt: SUBMITTED_AT,
    });
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.reason).toBe("CONSENT_SNAPSHOT_IMMUTABLE");
  });

  it("试图用新内容覆盖已固化快照 ⇒ 同样是 CONSENT_SNAPSHOT_IMMUTABLE，存储里的内容不变", async () => {
    const deps = consentRenderHarness({
      retentionParams: { projectOverrideDays: 90, orgDefaultDays: 180, deletionGraceDays: null },
      templates: { [TEMPLATE_ID]: TEMPLATE_TEXT },
    });
    deps.submissions.markSubmitted("consent-1");

    const rendered = await renderConsentText(deps, {
      orgId: "org-1", projectId: "prj-1", templateId: TEMPLATE_ID, resolvedAt: AT,
    });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;

    await freezeConsentSnapshot(deps, {
      consentId: "consent-1", templateId: TEMPLATE_ID,
      renderedText: rendered.renderedText, variables: rendered.variables,
      submittedAt: SUBMITTED_AT,
    });

    // 恶意/误操作尝试：拿一份完全不同的渲染结果去覆盖同一个 consentId。
    const attempt = await freezeConsentSnapshot(deps, {
      consentId: "consent-1",
      templateId: TEMPLATE_ID,
      renderedText: "这段文案被人事后改写了。",
      variables: { ...rendered.variables, retentionDays: 4000 },
      submittedAt: "2099-01-01T00:00:00.000Z",
    });
    expect(attempt.ok).toBe(false);
    expect(attempt.ok === false && attempt.reason).toBe("CONSENT_SNAPSHOT_IMMUTABLE");

    const stored = deps.snapshots.peek("consent-1");
    expect(stored?.renderedText).toBe(rendered.renderedText);
    expect(stored?.variables.retentionDays).toBe(90);
    expect(stored?.submittedAt).toBe(SUBMITTED_AT);
  });

  it("固化后改项目覆盖值 ⇒ 新渲染变化，但已固化快照三字段不变（AC2 核心）", async () => {
    const deps = consentRenderHarness({
      retentionParams: { projectOverrideDays: 90, orgDefaultDays: 180, deletionGraceDays: null },
      templates: { [TEMPLATE_ID]: TEMPLATE_TEXT },
    });
    deps.submissions.markSubmitted("consent-1");

    const rendered = await renderConsentText(deps, {
      orgId: "org-1", projectId: "prj-1", templateId: TEMPLATE_ID, resolvedAt: AT,
    });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.variables.retentionDays).toBe(90);

    const frozen = await freezeConsentSnapshot(deps, {
      consentId: "consent-1", templateId: TEMPLATE_ID,
      renderedText: rendered.renderedText, variables: rendered.variables,
      submittedAt: SUBMITTED_AT,
    });
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;

    // 项目把材料保留期覆盖值从 90 改成 30——后续新发出的同意书应该用新值。
    deps.retention.params.set({ projectOverrideDays: 30 });

    const rerendered = await renderConsentText(deps, {
      orgId: "org-1", projectId: "prj-1", templateId: TEMPLATE_ID, resolvedAt: AT,
    });
    expect(rerendered.ok).toBe(true);
    if (!rerendered.ok) return;
    expect(rerendered.variables.retentionDays).toBe(30);
    expect(rerendered.renderedText).toContain("30 天后自动删除");

    // 而 consent-1 的已固化快照——事后改参数不追溯，三字段保持不变。
    const snapshotAfterParamChange = await getConsentSnapshot(deps, "consent-1");
    expect(snapshotAfterParamChange?.renderedText).toBe(rendered.renderedText);
    expect(snapshotAfterParamChange?.variables.retentionDays).toBe(90);
    expect(snapshotAfterParamChange?.contentHash).toBe(frozen.contentHash);
    expect(snapshotAfterParamChange?.renderedText).toContain("90 天后自动删除");
  });

  it("哈希核对：直接绕过用例改写存储内容会被 verifyConsentSnapshotIntegrity 抓到", async () => {
    const deps = consentRenderHarness({
      retentionParams: { projectOverrideDays: null, orgDefaultDays: 180, deletionGraceDays: null },
      templates: { [TEMPLATE_ID]: TEMPLATE_TEXT },
    });
    deps.submissions.markSubmitted("consent-1");

    const rendered = await renderConsentText(deps, {
      orgId: "org-1", projectId: "prj-1", templateId: TEMPLATE_ID, resolvedAt: AT,
    });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;

    await freezeConsentSnapshot(deps, {
      consentId: "consent-1", templateId: TEMPLATE_ID,
      renderedText: rendered.renderedText, variables: rendered.variables,
      submittedAt: SUBMITTED_AT,
    });

    const stored = deps.snapshots.peek("consent-1");
    expect(stored).toBeDefined();
    if (stored === undefined) return;
    expect(verifyConsentSnapshotIntegrity(stored)).toBe(true);

    // 反证：篡改后哈希核对必须失败——否则这条完整性检查本身是空转的。
    const tampered = { ...stored, renderedText: "篡改后的文案" };
    expect(verifyConsentSnapshotIntegrity(tampered)).toBe(false);
  });
});
