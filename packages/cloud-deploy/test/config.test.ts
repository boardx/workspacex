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
  it("accepts only an explicit bounded Serverless TLS exception", () => {
    const value = deploymentExample("production");
    expect(validateDeploymentConfig({ ...value, environment: { ...value.environment,
      rdsTlsException: { kind: "aliyun-postgresql-serverless-no-tls", allowedCidrs: ["10.0.1.7/32"] } } }).ok).toBe(true);
    expect(validateDeploymentConfig({ ...value, environment: { ...value.environment,
      rdsTlsException: { kind: "aliyun-postgresql-serverless-no-tls", allowedCidrs: ["0.0.0.0/0"] } } }).ok).toBe(false);
  });
  it("accepts a bounded production preflight IP and rejects malformed targets", () => {
    const value = deploymentExample("production");
    expect(validateDeploymentConfig({ ...value, environment: { ...value.environment, preflightTargetIp: "47.100.1.2" } }).ok).toBe(true);
    for (const preflightTargetIp of ["www.boardx.com.cn", "999.1.2.3", "47.100.1.2:443"]) {
      expect(validateDeploymentConfig({ ...value, environment: { ...value.environment, preflightTargetIp } }).ok).toBe(false);
    }
    const starter = deploymentExample("starter");
    expect(validateDeploymentConfig({ ...starter, environment: { ...starter.environment, preflightTargetIp: "47.100.1.2" } }).ok).toBe(false);
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
  it("accepts an explicit realtime ASR profile and rejects partial or unsafe profiles", () => {
    const input = deploymentExample("production");
    const asrProfile = {
      provider: "dashscope",
      baseUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
      modelId: "qwen3-asr-flash-realtime",
      apiKeySecretRef: "env:WORKSPACEX_ASR_KEY",
    };
    expect(validateDeploymentConfig({
      ...input,
      provision: { ...input.provision, asrProfile },
    }).ok).toBe(true);
    expect(validateDeploymentConfig({ ...input, provision: { ...input.provision,
      asrProfile: { ...asrProfile, recordingTurnSilenceMs: 650 } } }).ok).toBe(true);
    for (const value of [199, 2001, 600.5, "800"]) {
      expect(validateDeploymentConfig({ ...input, provision: { ...input.provision,
        asrProfile: { ...asrProfile, recordingTurnSilenceMs: value } } }).ok).toBe(false);
    }
    for (const invalid of [
      { ...asrProfile, baseUrl: "https://dashscope.aliyuncs.com/api-ws/v1/realtime" },
      { ...asrProfile, baseUrl: "wss://user:secret@dashscope.aliyuncs.com/api-ws/v1/realtime" },
      { ...asrProfile, apiKeySecretRef: "secret-value" },
      { provider: asrProfile.provider },
    ]) {
      expect(validateDeploymentConfig({
        ...input,
        provision: { ...input.provision, asrProfile: invalid },
      }).ok).toBe(false);
    }
  });
  it("accepts a bounded platform-superuser list and rejects case-insensitive duplicates", () => {
    const input = deploymentExample("production");
    expect(validateDeploymentConfig({
      ...input,
      provision: { ...input.provision, platformSuperuserEmails: ["ops@example.com", "owner@example.com"] },
    }).ok).toBe(true);
    expect(validateDeploymentConfig({
      ...input,
      provision: { ...input.provision, platformSuperuserEmails: ["Ops@example.com", "ops@example.com"] },
    }).ok).toBe(false);
    expect(validateDeploymentConfig({
      ...input,
      provision: { ...input.provision, platformSuperuserEmails: [] },
    }).ok).toBe(false);
  });
  it("accepts an optional feedback GitHub issue profile and rejects raw tokens or unsafe repository names", () => {
    const input = deploymentExample("production");
    const githubIssueProfile = {
      tokenSecretRef: "env:WORKSPACEX_GITHUB_ISSUE_TOKEN",
      repoOwner: "boardx",
      repoName: "workspacex",
      attachmentsBranch: "feedback-attachments",
    };
    expect(validateDeploymentConfig({
      ...input,
      provision: { ...input.provision, githubIssueProfile },
    }).ok).toBe(true);
    for (const invalid of [
      { ...githubIssueProfile, tokenSecretRef: "github_pat_secret" },
      { ...githubIssueProfile, repoOwner: "../boardx" },
      { ...githubIssueProfile, repoName: "workspacex/issues" },
      { ...githubIssueProfile, attachmentsBranch: "main~1" },
      { tokenSecretRef: githubIssueProfile.tokenSecretRef },
    ]) {
      expect(validateDeploymentConfig({
        ...input,
        provision: { ...input.provision, githubIssueProfile: invalid },
      }).ok).toBe(false);
    }
  });
  it("accepts an optional mail profile and rejects a sender outside the onboarded sending domain", () => {
    const input = deploymentExample("production");
    const mailProfile = {
      cloudflareAccountId: "0123456789abcdef0123456789abcdef",
      apiTokenSecretRef: "env:WORKSPACEX_MAIL_TOKEN",
      mailFrom: "no-reply@mail.example.com",
      sendingDomain: "mail.example.com",
    };
    expect(validateDeploymentConfig({ ...input, provision: { ...input.provision, mailProfile } }).ok).toBe(true);
    const mismatch = validateDeploymentConfig({ ...input, provision: { ...input.provision, mailProfile: { ...mailProfile, mailFrom: "no-reply@example.com" } } });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.errors).toContainEqual({ path: "provision.mailProfile.mailFrom", code: "MAIL_FROM_NOT_ON_SENDING_DOMAIN" });
    for (const invalid of [
      { ...mailProfile, apiTokenSecretRef: "raw-token-value" },
      { ...mailProfile, sendingDomain: "Mail.Example.com" },
      { cloudflareAccountId: mailProfile.cloudflareAccountId },
    ]) {
      expect(validateDeploymentConfig({ ...input, provision: { ...input.provision, mailProfile: invalid } }).ok).toBe(false);
    }
  });
  it("does not expose connection references or email in the plan", () => {
    const value = deploymentExample("production");
    value.provision.asrProfile = {
      provider: "dashscope",
      baseUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
      modelId: "qwen3-asr-flash-realtime",
      apiKeySecretRef: "env:WORKSPACEX_ASR_KEY",
    };
    value.provision.githubIssueProfile = {
      tokenSecretRef: "env:WORKSPACEX_GITHUB_ISSUE_TOKEN",
      repoOwner: "boardx",
      repoName: "workspacex",
      attachmentsBranch: "feedback-attachments",
    };
    const result = validateDeploymentConfig(value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.plan)).not.toContain(value.environment.databaseSecretRef);
    expect(JSON.stringify(result.plan)).not.toContain(value.provision.adminEmail);
    expect(JSON.stringify(result.plan)).not.toContain(value.provision.asrProfile.apiKeySecretRef);
    expect(JSON.stringify(result.plan)).not.toContain(value.provision.githubIssueProfile.tokenSecretRef);
  });
});
