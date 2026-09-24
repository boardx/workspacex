import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IMAGE_CONFIG, lockMinioImage, REPO_ROOT, validateMinioImageConfig } from "./minio-controlled-image.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "wsx-minio-image-"));
  for (const relative of [
    IMAGE_CONFIG,
    "apps/api/docker-compose.dev.yml",
    "apps/api/docker-compose.deploy.yml",
  ]) {
    const target = resolve(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(resolve(REPO_ROOT, relative), target, { recursive: true });
  }
  return root;
};

describe("controlled MinIO image lock", () => {
  it("keeps both compose consumers on the one shared image declaration", () => {
    const result = validateMinioImageConfig(REPO_ROOT);
    expect(result.metadata.status).toBe("awaiting-controlled-mirror");
    expect(() => validateMinioImageConfig(REPO_ROOT, { requireLocked: true })).toThrow(/not published/);
    for (const relative of ["apps/api/docker-compose.dev.yml", "apps/api/docker-compose.deploy.yml"]) {
      expect(readFileSync(resolve(REPO_ROOT, relative), "utf8")).not.toMatch(/^\s*image:\s+.*minio/m);
    }
  });

  it("renders only a verified lowercase sha256 digest into the controlled target", () => {
    const root = fixture();
    const digest = `sha256:${"a".repeat(64)}`;
    lockMinioImage(root, digest);
    const result = validateMinioImageConfig(root, { requireLocked: true });
    expect(result.image).toBe(`ghcr.io/boardx/workspacex-minio@${digest}`);
    expect(result.metadata.source_digest).toBe(digest);
    expect(result.metadata.target_digest).toBe(digest);
  });

  it("rejects invented digests, duplicated consumer images, and digest drift", () => {
    const root = fixture();
    expect(() => lockMinioImage(root, "sha256:not-a-digest")).toThrow(/exactly 64/);
    const dev = resolve(root, "apps/api/docker-compose.dev.yml");
    writeFileSync(dev, readFileSync(dev, "utf8").replace("  minio:\n", "  minio:\n    image: minio/minio:latest\n"));
    expect(() => validateMinioImageConfig(root)).toThrow(/duplicates/);
  });

  it("keeps mirroring human-triggered and makes anonymous verification precede lock rendering", () => {
    const workflow = readFileSync(resolve(REPO_ROOT, ".github/workflows/mirror-minio-controlled-registry.yml"), "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("packages: write");
    expect(workflow).toContain("skopeo copy --all --preserve-digests");
    const publicCheck = workflow.indexOf('skopeo inspect --raw "docker://${TARGET}@${DIGEST}"');
    const renderLock = workflow.indexOf('minio-controlled-image.mjs lock "${DIGEST}"');
    expect(publicCheck).toBeGreaterThan(0);
    expect(renderLock).toBeGreaterThan(publicCheck);
    expect(workflow.slice(publicCheck, renderLock)).not.toContain("--creds");
  });
});
