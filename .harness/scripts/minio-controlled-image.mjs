import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, "../..");
export const IMAGE_CONFIG = "apps/api/docker-compose.minio-image.yml";
const COMPOSE_CONSUMERS = [
  "apps/api/docker-compose.dev.yml",
  "apps/api/docker-compose.deploy.yml",
];
const DIGEST = /^sha256:[a-f0-9]{64}$/;

const fail = (message) => { throw new Error(`[minio-image-lock] ${message}`); };

export function validateMinioImageConfig(root = REPO_ROOT, { requireLocked = false } = {}) {
  const configPath = resolve(root, IMAGE_CONFIG);
  const document = parse(readFileSync(configPath, "utf8"));
  const metadata = document?.["x-workspacex-minio-image"];
  const image = document?.services?.["minio-image"]?.image;
  if (!metadata || typeof metadata !== "object") fail("missing x-workspacex-minio-image metadata");
  if (metadata.source_repository !== "cgr.dev/chainguard/minio") fail("unexpected upstream repository");
  const sourceDigest = requireDigest(metadata.source_digest, "configured source digest");
  if (metadata.target_repository !== "ghcr.io/boardx/workspacex-minio") fail("target must remain in the BoardX-controlled GHCR namespace");

  if (metadata.status === "awaiting-controlled-mirror") {
    if (requireLocked) fail("controlled mirror is not published and anonymously verified yet");
    if (metadata.target_digest !== undefined) fail("awaiting state must not claim an unverified target digest");
    const expected = `${metadata.source_repository}@${sourceDigest}`;
    if (image !== expected) fail(`awaiting state must retain the immutable upstream image ${expected}`);
  } else if (metadata.status === "locked") {
    if (!DIGEST.test(metadata.source_digest ?? "") || !DIGEST.test(metadata.target_digest ?? "")) fail("locked state requires exact sha256 source and target digests");
    if (metadata.source_digest !== metadata.target_digest) fail("mirror workflow must preserve the upstream manifest digest");
    const expected = `${metadata.target_repository}@${metadata.target_digest}`;
    if (image !== expected) fail(`locked compose image must be ${expected}`);
  } else {
    fail("status must be awaiting-controlled-mirror or locked");
  }

  for (const consumer of COMPOSE_CONSUMERS) {
    const compose = parse(readFileSync(resolve(root, consumer), "utf8"));
    const minio = compose?.services?.minio;
    if (!minio) fail(`${consumer} has no minio service`);
    if (Object.hasOwn(minio, "image")) fail(`${consumer} duplicates the MinIO image declaration`);
    if (minio.extends?.file !== "docker-compose.minio-image.yml" || minio.extends?.service !== "minio-image") {
      fail(`${consumer} must extend the shared minio-image service`);
    }
  }
  return { metadata, image };
}

export function lockMinioImage(root = REPO_ROOT, digest) {
  if (!DIGEST.test(digest ?? "")) fail("digest must be sha256 followed by exactly 64 lowercase hexadecimal characters");
  const { metadata } = validateMinioImageConfig(root);
  if (metadata.status !== "awaiting-controlled-mirror") fail("lock generation only accepts the awaiting-controlled-mirror state");
  const configPath = resolve(root, IMAGE_CONFIG);
  if (digest !== metadata.source_digest) fail("controlled target digest must equal the configured source digest");
  const currentImage = `${metadata.source_repository}@${metadata.source_digest}`;
  const lockedImage = `${metadata.target_repository}@${digest}`;
  let text = readFileSync(configPath, "utf8");
  text = text.replace(
    "  status: awaiting-controlled-mirror\n",
    `  status: locked\n  target_digest: ${digest}\n`,
  );
  text = text.replace(`    image: ${currentImage}\n`, `    image: ${lockedImage}\n`);
  writeFileSync(configPath, text);
  validateMinioImageConfig(root, { requireLocked: true });
}

const requireDigest = (value, label) => {
  if (!DIGEST.test(value ?? "")) fail(`${label} must be an exact lowercase sha256 digest`);
  return value;
};

const requireRunId = (value) => {
  const text = String(value ?? "");
  if (!/^[1-9][0-9]*$/.test(text)) fail("mirror run id must be a positive integer");
  return text;
};

export function minioImageCoordinates(root = REPO_ROOT) {
  const { metadata } = validateMinioImageConfig(root);
  if (metadata.status !== "awaiting-controlled-mirror") {
    fail("mirror promotion only accepts the awaiting-controlled-mirror state");
  }
  return {
    sourceRepository: metadata.source_repository,
    sourceDigest: metadata.source_digest,
    targetRepository: metadata.target_repository,
  };
}

export function createMinioMirrorReceipt(root = REPO_ROOT, values) {
  const coordinates = minioImageCoordinates(root);
  const digest = requireDigest(values?.digest, "resolved upstream digest");
  if (digest !== coordinates.sourceDigest) fail("resolved upstream digest differs from repository configuration");
  const repository = values?.repository;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    fail("workflow repository must be owner/name");
  }
  if (!/^[a-f0-9]{40}$/.test(values?.sourceCommit ?? "")) {
    fail("source commit must be a full lowercase Git commit SHA");
  }
  const runAttempt = String(values?.runAttempt ?? "");
  if (!/^[1-9][0-9]*$/.test(runAttempt)) fail("run attempt must be a positive integer");
  return {
    schema: "workspacex.minio-mirror-receipt.v1",
    operation: "mirror",
    ...coordinates,
    sourceDigest: digest,
    authenticatedTargetDigest: digest,
    repository,
    sourceCommit: values.sourceCommit,
    runId: requireRunId(values?.runId),
    runAttempt,
  };
}

export function validateMinioMirrorEvidence(root = REPO_ROOT, receipt, evidence) {
  const coordinates = minioImageCoordinates(root);
  if (!receipt || typeof receipt !== "object") fail("mirror receipt must be a JSON object");
  if (receipt.schema !== "workspacex.minio-mirror-receipt.v1" || receipt.operation !== "mirror") {
    fail("mirror receipt has an unsupported schema or operation");
  }
  for (const [key, expected] of Object.entries(coordinates)) {
    if (receipt[key] !== expected) fail(`mirror receipt ${key} does not match repository configuration`);
  }
  if (receipt.repository !== evidence?.repository) fail("mirror receipt repository does not match this workflow repository");
  if (receipt.sourceCommit !== evidence?.sourceCommit) fail("mirror receipt commit does not match the attested workflow run");
  if (receipt.runId !== requireRunId(evidence?.runId)) fail("mirror receipt run id does not match the attested workflow run");
  if (receipt.runAttempt !== requireRunId(evidence?.runAttempt)) fail("mirror receipt run attempt does not match the attested workflow run");

  const receiptSource = requireDigest(receipt.sourceDigest, "receipt source digest");
  const receiptTarget = requireDigest(receipt.authenticatedTargetDigest, "receipt authenticated target digest");
  const upstream = requireDigest(evidence?.upstreamDigest, "currently resolved upstream digest");
  const anonymousTarget = requireDigest(evidence?.anonymousTargetDigest, "anonymous target digest");
  if (receiptSource !== receiptTarget) fail("mirror receipt source and authenticated target digests differ");
  if (receiptSource !== upstream) fail("configured upstream digest differs from the attested digest");
  if (receiptSource !== anonymousTarget) fail("anonymous controlled target digest differs from the attested upstream digest");
  return { digest: receiptSource, ...coordinates };
}

function usage() {
  console.error("usage: node .harness/scripts/minio-controlled-image.mjs validate [--require-locked] | lock <sha256:digest> | coordinates | write-receipt <path> <digest> <run-id> <run-attempt> <repository> <commit> | verify-receipt <path> <upstream-digest> <anonymous-target-digest> <run-id> <run-attempt> <repository> <commit>");
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    if (command === "validate") {
      validateMinioImageConfig(REPO_ROOT, { requireLocked: process.argv.includes("--require-locked") });
      console.log("✓ MinIO compose image source and consumers are consistent");
    } else if (command === "lock" && process.argv.length === 4) {
      lockMinioImage(REPO_ROOT, process.argv[3]);
      console.log(`✓ wrote immutable controlled-registry lock for ${process.argv[3]}`);
    } else if (command === "coordinates" && process.argv.length === 3) {
      console.log(JSON.stringify(minioImageCoordinates(REPO_ROOT)));
    } else if (command === "write-receipt" && process.argv.length === 9) {
      const receipt = createMinioMirrorReceipt(REPO_ROOT, {
        digest: process.argv[4],
        runId: process.argv[5],
        runAttempt: process.argv[6],
        repository: process.argv[7],
        sourceCommit: process.argv[8],
      });
      writeFileSync(process.argv[3], `${JSON.stringify(receipt, null, 2)}\n`);
      console.log(`✓ wrote mirror receipt for ${receipt.sourceDigest}`);
    } else if (command === "verify-receipt" && process.argv.length === 10) {
      const receipt = JSON.parse(readFileSync(process.argv[3], "utf8"));
      const result = validateMinioMirrorEvidence(REPO_ROOT, receipt, {
        upstreamDigest: process.argv[4],
        anonymousTargetDigest: process.argv[5],
        runId: process.argv[6],
        runAttempt: process.argv[7],
        repository: process.argv[8],
        sourceCommit: process.argv[9],
      });
      console.log(result.digest);
    } else {
      usage();
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
