import { describe, expect, it } from "vitest";
import { deploymentExample } from "../src/index";
import { candidateConfigurationPaths, candidateIdentitySchema, createCandidateConfiguration, verifyCandidateConfiguration } from "../src/cn-candidate-config";
const identity = { revision: "a".repeat(40), release: "2026.9.30-cn.1", attemptId: "12345-1" };
const baseline = JSON.stringify(deploymentExample("production"));
describe("attempt-bound candidate configuration", () => {
  it("changes only release without mutating baseline values or secret references", () => {
    const result = createCandidateConfiguration(baseline, identity);
    const original = JSON.parse(baseline), candidate = JSON.parse(result.candidateBytes);
    expect(candidate.provision.release).toBe(identity.release);
    candidate.provision.release = original.provision.release;
    expect(candidate).toEqual(original);
    expect(JSON.stringify(deploymentExample("production"))).toBe(baseline);
  });
  it("is deterministic for the same exact attempt", () => {
    expect(createCandidateConfiguration(baseline, identity)).toEqual(createCandidateConfiguration(baseline, identity));
  });
  it("recognizes unchanged baseline as prepared and exact candidate as activated", () => {
    const value = createCandidateConfiguration(baseline, identity);
    expect(verifyCandidateConfiguration(baseline, value.candidateBytes, value.receipt, identity, baseline)).toBe("prepared");
    expect(verifyCandidateConfiguration(baseline, value.candidateBytes, value.receipt, identity, value.candidateBytes)).toBe("activated");
  });
  it("rejects active config drift even when release still matches", () => {
    const value = createCandidateConfiguration(baseline, identity), active = JSON.parse(value.candidateBytes);
    active.provision.adminEmail = "attacker@example.com";
    expect(() => verifyCandidateConfiguration(baseline, value.candidateBytes, value.receipt, identity, JSON.stringify(active))).toThrow("ACTIVE_CONFIGURATION_CHANGED");
  });
  it("rejects candidate edits including a secret reference", () => {
    const value = createCandidateConfiguration(baseline, identity), candidate = JSON.parse(value.candidateBytes);
    candidate.environment.databaseSecretRef = "file:/etc/other-database.json";
    expect(() => verifyCandidateConfiguration(baseline, JSON.stringify(candidate), value.receipt, identity, baseline)).toThrow("CANDIDATE_CONFIGURATION_CHANGED");
  });
  it.each(["revision", "release", "attemptId"] as const)("rejects receipt from another %s", key => {
    const value = createCandidateConfiguration(baseline, identity);
    const different = { ...identity, [key]: key === "revision" ? "b".repeat(40) : key === "release" ? "2026.9.30-cn.2" : "12345-2" };
    expect(() => verifyCandidateConfiguration(baseline, value.candidateBytes, value.receipt, different, baseline)).toThrow("CANDIDATE_IDENTITY_MISMATCH");
  });
  it.each(["baselineSha256", "candidateSha256"] as const)("rejects forged %s", key => {
    const value = createCandidateConfiguration(baseline, identity);
    expect(() => verifyCandidateConfiguration(baseline, value.candidateBytes, { ...value.receipt, [key]: "0".repeat(64) }, identity, baseline)).toThrow("CANDIDATE_CONFIGURATION_CHANGED");
  });
  it("rejects alternate whitespace bytes instead of widening exact receipt evidence", () => {
    const value = createCandidateConfiguration(baseline, identity);
    expect(() => verifyCandidateConfiguration(`${baseline}\n`, value.candidateBytes, value.receipt, identity, baseline)).toThrow("CANDIDATE_CONFIGURATION_CHANGED");
  });
  it.each(["../attempt", "a/b", "A", "", "a".repeat(129)])("rejects unsafe attempt %s", attemptId => {
    expect(() => candidateConfigurationPaths({ ...identity, attemptId })).toThrow();
  });
  it.each(["34866488153-1", "github.34866488153.2", "a".repeat(128)])("accepts canonical workflow attempt %s", attemptId => {
    expect(candidateIdentitySchema.parse({ ...identity, attemptId }).attemptId).toBe(attemptId);
  });
  it("uses fixed root paths bound to revision and attempt", () => {
    expect(candidateConfigurationPaths(identity).candidate).toBe(`/etc/workspacex-cn/candidate-configs/${identity.revision}/${identity.attemptId}/deployment.json`);
    expect(candidateConfigurationPaths(identity).active).toBe("/etc/workspacex-cn/deployment.json");
  });
  it("rejects unvalidated schema and floating release", () => {
    expect(() => createCandidateConfiguration("{}", identity)).toThrow();
    expect(() => candidateIdentitySchema.parse({ ...identity, release: "latest" })).toThrow();
  });
});
