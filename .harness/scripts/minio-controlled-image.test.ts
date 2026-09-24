import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  createMinioMirrorReceipt,
  IMAGE_CONFIG,
  lockMinioImage,
  REPO_ROOT,
  validateMinioImageConfig,
  validateMinioMirrorEvidence,
} from "./minio-controlled-image.mjs";

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
  const configuredDigest = "sha256:bd014394a80898e68c149f2311fdf8d5a2c2f3bb2c33b9327ae6d02b4b065ae1";
  const digestB = `sha256:${"b".repeat(64)}`;
  const workflowRepository = "boardx/workspacex";
  const sourceCommit = "c".repeat(40);
  const receiptFor = (root: string, digest = configuredDigest) => createMinioMirrorReceipt(root, {
    digest,
    runId: "4102",
    runAttempt: "1",
    repository: workflowRepository,
    sourceCommit,
  });
  const evidenceFor = (upstreamDigest = configuredDigest, anonymousTargetDigest = configuredDigest) => ({
    upstreamDigest,
    anonymousTargetDigest,
    runId: "4102",
    runAttempt: "1",
    repository: workflowRepository,
    sourceCommit,
  });

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
    const digest = configuredDigest;
    lockMinioImage(root, digest);
    const result = validateMinioImageConfig(root, { requireLocked: true });
    expect(result.image).toBe(`ghcr.io/boardx/workspacex-minio@${digest}`);
    expect(result.metadata.source_digest).toBe(digest);
    expect(result.metadata.target_digest).toBe(digest);
  });

  it("accepts only evidence bound to the configured source, attested run, and equal digests", () => {
    const root = fixture();
    const receipt = receiptFor(root);
    expect(validateMinioMirrorEvidence(root, receipt, evidenceFor())).toMatchObject({
      digest: configuredDigest,
      sourceDigest: configuredDigest,
    });
  });

  it("rejects a valid-but-wrong digest and anonymous target drift", () => {
    const root = fixture();
    expect(() => receiptFor(root, digestB)).toThrow(/differs from repository configuration/);
    const wrongReceipt = { ...receiptFor(root), sourceDigest: digestB, authenticatedTargetDigest: digestB };
    expect(() => validateMinioMirrorEvidence(root, wrongReceipt, evidenceFor())).toThrow(/sourceDigest/);
    expect(() => validateMinioMirrorEvidence(root, receiptFor(root), evidenceFor(configuredDigest, digestB))).toThrow(/anonymous controlled target/);
  });

  it("rejects a receipt when the repository's configured upstream digest has changed", () => {
    const root = fixture();
    const receipt = receiptFor(root);
    const config = resolve(root, IMAGE_CONFIG);
    writeFileSync(config, readFileSync(config, "utf8").replaceAll(
      configuredDigest,
      digestB,
    ));
    expect(() => validateMinioMirrorEvidence(root, receipt, evidenceFor())).toThrow(/sourceDigest/);
  });

  it("rejects direct verification without a mirror receipt or its exact run binding", () => {
    const root = fixture();
    expect(() => validateMinioMirrorEvidence(root, null, evidenceFor())).toThrow(/JSON object/);
    expect(() => validateMinioMirrorEvidence(root, receiptFor(root), {
      ...evidenceFor(),
      runId: "4103",
    })).toThrow(/run id/);
  });

  it("rejects invented digests, duplicated consumer images, and digest drift", () => {
    const root = fixture();
    expect(() => lockMinioImage(root, "sha256:not-a-digest")).toThrow(/exactly 64/);
    const dev = resolve(root, "apps/api/docker-compose.dev.yml");
    writeFileSync(dev, readFileSync(dev, "utf8").replace("  minio:\n", "  minio:\n    image: minio/minio:latest\n"));
    expect(() => validateMinioImageConfig(root)).toThrow(/duplicates/);
  });

  it("keeps mirroring human-triggered and makes anonymous verification consume a signed mirror receipt", () => {
    const workflow = readFileSync(resolve(REPO_ROOT, ".github/workflows/mirror-minio-controlled-registry.yml"), "utf8");
    const document = parse(workflow);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("source_digest:");
    expect(document.permissions).toEqual({ contents: "read" });
    expect(document.jobs.mirror.permissions).toMatchObject({ packages: "write", "id-token": "write", attestations: "write" });
    expect(document.jobs["verify-public-and-render-lock"].permissions).toEqual({
      actions: "read",
      attestations: "read",
      contents: "read",
    });
    expect(workflow).toContain("skopeo copy --all --preserve-digests");
    expect(workflow).toContain("actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a # v3.0.0");
    expect(workflow).toContain("gh attestation verify");
    expect(workflow).toContain("verify requires mirror_run_id from a successful mirror operation");
    const attestationCheck = workflow.indexOf("gh attestation verify");
    const publicCheck = workflow.indexOf('skopeo inspect --raw "docker://${target}@${receipt_digest}"');
    const renderLock = workflow.indexOf('minio-controlled-image.mjs lock "${digest}"');
    expect(attestationCheck).toBeGreaterThan(0);
    expect(publicCheck).toBeGreaterThan(attestationCheck);
    expect(publicCheck).toBeGreaterThan(0);
    expect(renderLock).toBeGreaterThan(publicCheck);
    expect(workflow.slice(publicCheck, renderLock)).not.toContain("--creds");
  });

  it("invokes gh attestation verify with the exact signer identity and provenance flags", () => {
    const workflow = parse(readFileSync(resolve(REPO_ROOT, ".github/workflows/mirror-minio-controlled-registry.yml"), "utf8"));
    const verifyStep = workflow.jobs["verify-public-and-render-lock"].steps.find(
      (step: { name?: string }) => step.name === "Verify the receipt's GitHub-signed provenance",
    );
    expect(verifyStep?.run).toBeTypeOf("string");

    const root = mkdtempSync(join(tmpdir(), "wsx-minio-gh-argv-"));
    const bin = resolve(root, "bin");
    const argvFile = resolve(root, "gh-argv.txt");
    mkdirSync(bin, { recursive: true });
    const fakeGh = resolve(bin, "gh");
    writeFileSync(fakeGh, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$GH_ARGV_FILE\"\n");
    chmodSync(fakeGh, 0o755);

    const result = spawnSync("bash", ["-c", verifyStep.run], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        GH_ARGV_FILE: argvFile,
        GH_TOKEN: "fixture-token",
        GITHUB_REPOSITORY: "boardx/workspacex",
        GITHUB_SERVER_URL: "https://github.com",
        DEFAULT_BRANCH: "main",
        MIRROR_HEAD_SHA: "c".repeat(40),
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(argvFile, "utf8").trim().split("\n")).toEqual([
      "attestation",
      "verify",
      "mirror-receipt/minio-mirror-receipt.json",
      "--repo",
      "boardx/workspacex",
      "--signer-workflow",
      "boardx/workspacex/.github/workflows/mirror-minio-controlled-registry.yml",
      "--source-ref",
      "refs/heads/main",
      "--source-digest",
      "c".repeat(40),
      "--deny-self-hosted-runners",
    ]);
  });

  it("executes the mirror copy step without an ambient tag and derives its target tag from the digest", () => {
    const workflow = parse(readFileSync(resolve(REPO_ROOT, ".github/workflows/mirror-minio-controlled-registry.yml"), "utf8"));
    const copyStep = workflow.jobs.mirror.steps.find(
      (step: { name?: string }) => step.name === "Copy the resolved upstream manifest and all platforms without changing digests",
    );
    expect(copyStep?.run).toBeTypeOf("string");

    const root = mkdtempSync(join(tmpdir(), "wsx-minio-copy-argv-"));
    const bin = resolve(root, "bin");
    const argvFile = resolve(root, "skopeo-argv.txt");
    mkdirSync(bin, { recursive: true });
    const fakeSkopeo = resolve(bin, "skopeo");
    writeFileSync(fakeSkopeo, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$SKOPEO_ARGV_FILE\"\n[ \"$1\" != inspect ] || printf fixture-manifest\n");
    chmodSync(fakeSkopeo, 0o755);
    const fakeSha256sum = resolve(bin, "sha256sum");
    writeFileSync(fakeSha256sum, "#!/bin/sh\nprintf '%s  %s\\n' \"$EXPECTED_DIGEST_HEX\" \"$1\"\n");
    chmodSync(fakeSha256sum, 0o755);

    const source = "cgr.dev/chainguard/minio";
    const target = "ghcr.io/boardx/workspacex-minio";
    const run = String(copyStep.run).replace("${{ secrets.GITHUB_TOKEN }}", "fixture-token");
    const execute = (script: string) => spawnSync("bash", ["-c", script], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        SKOPEO_ARGV_FILE: argvFile,
        EXPECTED_DIGEST_HEX: configuredDigest.slice("sha256:".length),
        SOURCE: source,
        TARGET: target,
        DIGEST: configuredDigest,
        GITHUB_ACTOR: "fixture-actor",
      },
    });
    const result = execute(run);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(argvFile, "utf8").trim().split("\n")).toEqual([
      `copy --all --preserve-digests docker://${source}@${configuredDigest} docker://${target}:sha256-${configuredDigest.slice("sha256:".length)}`,
      `inspect --raw --creds fixture-actor:fixture-token docker://${target}@${configuredDigest}`,
    ]);

    const unbound = execute(run.replace("${target_tag}", "${TAG}"));
    expect(unbound.status).not.toBe(0);
    expect(unbound.stderr).toContain("TAG: unbound variable");
  });
});
