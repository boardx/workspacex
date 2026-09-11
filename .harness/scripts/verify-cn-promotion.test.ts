import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const verifier = join(process.cwd(), ".harness/scripts/verify-cn-promotion.mjs");
const prefix = "registry.cn-hangzhou.aliyuncs.com/workspacex-cn";
const images = Object.fromEntries(
  ["web", "api", "agent", "sandbox"].map(name => [name, { image: `${prefix}/${name}@sha256:${"a".repeat(64)}` }]),
);
Object.assign(images, {
  postgres: { image: `docker.io/library/postgres@sha256:${"b".repeat(64)}` },
  redis: { image: `docker.io/library/redis@sha256:${"c".repeat(64)}` },
});

function repository() {
  const root = mkdtempSync(join(tmpdir(), "cn-promotion-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  writeFileSync(join(root, "README"), "release\n");
  git("add", "README");
  git("commit", "-qm", "release");
  const revision = git("rev-parse", "HEAD");
  git("branch", "main-cn");
  return { root, revision };
}

function verify(root: string, revision: string, manifest: unknown) {
  const path = join(root, "release.json");
  writeFileSync(path, JSON.stringify(manifest));
  return spawnSync(process.execPath, [verifier, revision, path, prefix, "main", "main-cn"], { cwd: root, encoding: "utf8" });
}

describe("CN production promotion gate", () => {
  it("keeps CN deployment isolated behind its branch, environment, runner, and concurrency group", () => {
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/deploy-cn-production.yml"), "utf8");
    expect(workflow).toContain("branches: [main-cn]");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).toContain("environment: production-cn");
    expect(workflow).toContain("runs-on: [self-hosted, linux, workspacex-cn-production]");
    expect(workflow).not.toContain("x64");
    expect(workflow).toContain("CN_ACR_REPOSITORY_PREFIX");
    expect(workflow).toContain("group: workspacex-cn-production-deploy");
    expect(workflow).toContain('manifest="/etc/workspacex-cn/releases/${REVISION}.json"');
    expect(workflow).toContain('sudo /usr/local/bin/workspacex-cn-deploy "${REVISION}"');
  });

  it("accepts the main-cn tip only when it is in main and all images use digests", () => {
    const { root, revision } = repository();
    const result = verify(root, revision, { sourceRevision: revision, images });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CN_PROMOTION_VERIFIED");
  });

  it("rejects a commit that main does not contain", () => {
    const { root, revision } = repository();
    execFileSync("git", ["checkout", "-q", "main-cn"], { cwd: root });
    writeFileSync(join(root, "CN"), "cn only\n");
    execFileSync("git", ["add", "CN"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "cn only"], { cwd: root });
    const cnRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const result = verify(root, cnRevision, { sourceRevision: cnRevision, images });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not contained in main");
    expect(revision).not.toBe(cnRevision);
  });

  it("rejects a mutable image tag", () => {
    const { root, revision } = repository();
    const result = verify(root, revision, { sourceRevision: revision, images: { ...images, web: { image: "registry.example.com/workspacex/web:latest" } } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("web image is not pinned");
  });

  it("requires application images in the configured ACR namespace but permits upstream data images", () => {
    const { root, revision } = repository();
    const result = verify(root, revision, {
      sourceRevision: revision,
      images: { ...images, api: { image: `registry.cn-hangzhou.aliyuncs.com/old/api@sha256:${"d".repeat(64)}` } },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("api image is outside the configured ACR namespace");

    const upstream = verify(root, revision, { sourceRevision: revision, images });
    expect(upstream.status).toBe(0);
  });
});
