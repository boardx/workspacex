import { describe, expect, it } from "vitest";
import { admissionItems, governanceReducer, initialGovernancePreview, missingAdmission } from "../../components/ai-capability-studio/governance-preview-model";

describe("governance preview dependency recovery", () => {
  it("applies server and side-effect caps and preserves removed-tool failure visibility", () => {
    const connected = governanceReducer(initialGovernancePreview(), { type: "reconnect", mutation: "keep", expectedRevision: 1, success: true });
    expect(governanceReducer(connected, { type: "grant", tool: "search", scope: "全体成员" }).toolScopes.search).toBe("仅某团队");
    expect(governanceReducer(connected, { type: "grant", tool: "export_report", scope: "仅某团队" }).toolScopes.export_report).toBe("未开放");
    const changed = governanceReducer(connected, { type: "discover-changes" });
    expect(changed.toolScopes.search).toBe("需人工确认每次");
    expect(changed.discoveredTools).not.toContain("legacy_search");
    expect(changed.notice).toContain("原引用显示依赖失败");
    expect(governanceReducer(changed, { type: "grant", tool: "legacy_search", scope: "仅某团队" }).toolScopes.legacy_search).toBeUndefined();
  });
  it("blocks enable after a failed current probe despite five manual passes", () => {
    let state = initialGovernancePreview();
    for (const item of admissionItems) state = governanceReducer(state, { type: "test", item, revision: 1, verdict: "通过", evidence: "manual" });
    state = governanceReducer(state, { type: "probe", revision: 1, reachable: false });
    expect(governanceReducer(state, { type: "enable", expectedRevision: 1 }).status).toBe("待测试");
    state = governanceReducer(state, { type: "probe", revision: 1, reachable: true });
    expect(governanceReducer(state, { type: "enable", expectedRevision: 1 }).status).toBe("已启用");
  });
  it("preserves a healthy saved connection when replacement fails", () => {
    const connected = governanceReducer(initialGovernancePreview(), { type: "reconnect", mutation: "replace", expectedRevision: 1, success: true });
    const failed = governanceReducer(connected, { type: "reconnect", mutation: "replace", expectedRevision: connected.configRevision, success: false });
    expect(failed.connectionStatus).toBe("已连接");
    expect(failed.notice).toContain("本次候选连接失败");
    expect(failed.toolScopes).toBe(connected.toolScopes);
  });
  it("rejects admission judgments without evidence", () => {
    const initial = initialGovernancePreview();
    const result = governanceReducer(initial, { type: "test", item: admissionItems[0], revision: 1, verdict: "通过", evidence: " " });
    expect(result.evidence).toHaveLength(0);
    expect(missingAdmission(result)).toHaveLength(5);
  });
  it("changes connection CAS when an endpoint changes without rotating a kept credential", () => {
    const initial = initialGovernancePreview();
    const changed = governanceReducer(initial, { type: "reconnect", mutation: "keep", expectedRevision: 1, success: true, endpoint: "https://new.example.test/mcp" });
    expect(changed.configRevision).toBe(2);
    expect(changed.credentialRevision).toBe(1);
    expect(changed.endpoint).toBe("https://new.example.test/mcp");
    expect(governanceReducer(changed, { type: "reconnect", mutation: "clear", expectedRevision: 1, success: true }).credentialConfigured).toBe(true);
  });
  it("requires all five current-revision tests and rejects old configuration evidence", () => {
    let state = initialGovernancePreview();
    for (const item of admissionItems) state = governanceReducer(state, { type: "test", item, revision: 1, verdict: "通过", evidence: "demo-evidence" });
    expect(missingAdmission(state)).toEqual([]);
    state = governanceReducer(state, { type: "enable", expectedRevision: 1 });
    expect(state.status).toBe("已启用");
    state = governanceReducer(state, { type: "configure", expectedRevision: 1 });
    expect(state.status).toBe("待测试");
    expect(missingAdmission(state)).toHaveLength(5);
    const stale = governanceReducer(state, { type: "test", item: admissionItems[0], revision: 1, verdict: "通过", evidence: "demo-evidence" });
    expect(stale.evidence).toBe(state.evidence);
    expect(governanceReducer(stale, { type: "enable", expectedRevision: 2 }).status).toBe("待测试");
  });
  it("does not accept not-applicable as passed or stale writes", () => {
    let state = initialGovernancePreview();
    state = governanceReducer(state, { type: "test", item: admissionItems[0], revision: 1, verdict: "不适用", evidence: "demo-evidence" });
    expect(missingAdmission(state)).toHaveLength(5);
    expect(governanceReducer(state, { type: "configure", expectedRevision: 0 }).revision).toBe(1);
    expect(governanceReducer(state, { type: "enable", expectedRevision: 0 }).status).toBe("待测试");
  });
  it("failed credential replacement or clearing preserves the old credential revision and grants", () => {
    const initial = initialGovernancePreview();
    for (const mutation of ["keep", "replace", "clear"] as const) {
      const failed = governanceReducer(initial, { type: "reconnect", mutation, expectedRevision: 1, success: false });
      expect(failed.credentialConfigured).toBe(true);
      expect(failed.credentialRevision).toBe(1);
      expect(failed.toolScopes).toBe(initial.toolScopes);
    }
  });
  it("successful clear removes credentials and discovery never grants new tools", () => {
    const initial = initialGovernancePreview();
    const cleared = governanceReducer(initial, { type: "reconnect", mutation: "clear", expectedRevision: 1, success: true });
    expect(cleared.credentialConfigured).toBe(false);
    expect(cleared.credentialRevision).toBe(2);
    expect(cleared.discoveredTools).toContain("export_report");
    expect(cleared.toolScopes.export_report).toBe("未开放");
    expect(governanceReducer(cleared, { type: "reconnect", mutation: "replace", expectedRevision: 1, success: true }).credentialConfigured).toBe(false);
    expect(governanceReducer(cleared, { type: "grant", tool: "export_report", scope: "需人工确认每次" }).toolScopes.export_report).toBe("需人工确认每次");
  });
});
