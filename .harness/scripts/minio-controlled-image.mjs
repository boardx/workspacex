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
  if (metadata.source_repository !== "quay.io/minio/minio") fail("unexpected upstream repository");
  if (!/^RELEASE\.[0-9TZ-]+$/.test(metadata.release_tag ?? "")) fail("release_tag must be an explicit MinIO release");
  if (metadata.target_repository !== "ghcr.io/boardx/workspacex-minio") fail("target must remain in the BoardX-controlled GHCR namespace");

  if (metadata.status === "awaiting-controlled-mirror") {
    if (requireLocked) fail("controlled mirror is not published and anonymously verified yet");
    if (metadata.source_digest !== undefined || metadata.target_digest !== undefined) fail("awaiting state must not claim unverified digests");
    const expected = `${metadata.source_repository}:${metadata.release_tag}`;
    if (image !== expected) fail(`awaiting state must retain the explicit upstream release ${expected}`);
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
  const currentImage = `${metadata.source_repository}:${metadata.release_tag}`;
  const lockedImage = `${metadata.target_repository}@${digest}`;
  let text = readFileSync(configPath, "utf8");
  text = text.replace(
    "  status: awaiting-controlled-mirror\n",
    `  status: locked\n  source_digest: ${digest}\n  target_digest: ${digest}\n`,
  );
  text = text.replace(`    image: ${currentImage}\n`, `    image: ${lockedImage}\n`);
  writeFileSync(configPath, text);
  validateMinioImageConfig(root, { requireLocked: true });
}

function usage() {
  console.error("usage: node .harness/scripts/minio-controlled-image.mjs validate [--require-locked] | lock <sha256:digest>");
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
    } else {
      usage();
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
