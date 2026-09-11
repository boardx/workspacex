import { describe, expect, it } from "vitest";
import { deploymentExample, validateDeploymentConfig } from "../src/index";

describe("cloud deployment configuration", () => {
  it.each(["starter", "production"] as const)("accepts the %s example", (profile) => {
    const result = validateDeploymentConfig(deploymentExample(profile));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.profile).toBe(profile);
    expect(result.plan.objectStorage).toBe("oss");
    expect(result.plan.cloudVerified).toBe(false);
    expect(result.plan.provisionDeadlineSeconds).toBe(300);
    expect(result.plan.database).toBe(profile === "starter" ? "ecs-postgresql" : "rds-postgresql");
  });
  it("reports multiple missing production parameters together", () => {
    const value = deploymentExample("production");
    const { databaseSecretRef, redisSecretRef, ...environment } = value.environment;
    const result = validateDeploymentConfig({ ...value, environment });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.path)).toEqual(expect.arrayContaining([
      "environment.databaseSecretRef", "environment.redisSecretRef",
    ]));
  });
  it("does not accept Starter settings under the production profile", () => {
    const value = deploymentExample("starter");
    expect(validateDeploymentConfig({ ...value, environment: { ...value.environment, profile: "production" } }).ok).toBe(false);
  });
  it.each([
    ["publicUrl", "http://workspace.example.com"],
    ["publicUrl", "https://user:secret@example.com"],
    ["publicUrl", "https://workspace.example.com/?key=secret"],
    ["ossEndpoint", "https://oss-cn-beijing-internal.aliyuncs.com"],
    ["ossEndpoint", "https://evil.example.com"],
    ["ossBucket", "REPLACE_WITH_PRIVATE_BUCKET"],
    ["ossPrefix", "../another-deployment"],
    ["dataVolumePath", "/"],
    ["dataVolumePath", "/var/../etc"],
    ["dataVolumePath", "./data"],
  ])("rejects invalid %s", (key, value) => {
    const input = deploymentExample("starter");
    expect(validateDeploymentConfig({ ...input, environment: { ...input.environment, [key]: value } }).ok).toBe(false);
  });
  it.each(["latest", "REPLACE_WITH_VERIFIED_RELEASE", "1.0.0; curl bad"])("rejects unpinned release %s", (release) => {
    const input = deploymentExample("starter");
    expect(validateDeploymentConfig({ ...input, provision: { ...input.provision, release } }).ok).toBe(false);
  });
  it("rejects secret values and unknown keys without disclosing their content", () => {
    const input = deploymentExample("production");
    const secret = "SENSITIVE_PASSWORD_123";
    const result = validateDeploymentConfig({ ...input, environment: {
      ...input.environment, databaseSecretRef: `postgres://admin:${secret}@host/db`, [secret]: secret,
    } });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("postgres://");
  });
  it("validates types, production retention and separate database roles", () => {
    const input = deploymentExample("production");
    for (const patch of [
      { backupRetentionDays: 0 }, { backupRetentionDays: "7" },
      { migrationSecretRef: input.environment.databaseSecretRef },
    ]) expect(validateDeploymentConfig({ ...input, environment: { ...input.environment, ...patch } }).ok).toBe(false);
  });
  it("rejects placeholder model keys and credential-bearing model URLs", () => {
    const input = deploymentExample("starter");
    for (const patch of [{ apiKeySecretRef: "REPLACE_WITH_MODEL_SECRET_REF" }, { baseUrl: "https://api.example.com/v1?api_key=secret" }]) {
      expect(validateDeploymentConfig({ ...input, provision: { ...input.provision,
        modelProfile: { ...input.provision.modelProfile, ...patch },
      } }).ok).toBe(false);
    }
  });
  it("does not expose connection references or email in the plan", () => {
    const value = deploymentExample("production");
    const result = validateDeploymentConfig(value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.plan)).not.toContain(value.environment.databaseSecretRef);
    expect(JSON.stringify(result.plan)).not.toContain(value.provision.adminEmail);
  });
});
