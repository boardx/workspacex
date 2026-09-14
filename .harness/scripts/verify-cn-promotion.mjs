#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function fail(message) {
  process.stderr.write(`CN_PROMOTION_REJECTED: ${message}\n`);
  process.exit(1);
}

const [revision, manifestPath, sealPath, acrRepositoryPrefix, mainRef = "origin/main", cnRef = "origin/main-cn"] = process.argv.slice(2);
if (!revision || !manifestPath || !sealPath || !acrRepositoryPrefix || process.argv.length > 8) {
  fail("usage: verify-cn-promotion.mjs <revision> <manifest> <seal> <acr-repository-prefix> [main-ref] [cn-ref]");
}
if (!/^[a-f0-9]{40}$/.test(revision)) fail("revision must be a full commit SHA");
if (!/^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(acrRepositoryPrefix)) {
  fail("ACR repository prefix is invalid");
}

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    fail(`git check failed: ${args.join(" ")}`);
  }
}

git(["cat-file", "-e", `${revision}^{commit}`]);
if (git(["rev-parse", cnRef]) !== revision) fail(`revision is not the current ${cnRef} tip`);
try {
  execFileSync("git", ["merge-base", "--is-ancestor", revision, mainRef], { stdio: "ignore" });
} catch {
  fail(`revision is not contained in ${mainRef}`);
}

let manifest, manifestBytes, seal;
try {
  manifestBytes = readFileSync(manifestPath);
  manifest = JSON.parse(manifestBytes.toString("utf8"));
} catch {
  fail("release manifest is missing or invalid JSON");
}
try {
  seal = JSON.parse(readFileSync(sealPath, "utf8"));
} catch {
  fail("release seal is missing or invalid JSON");
}
const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
if (seal?.schemaVersion !== 1 || seal?.status !== "sealed" || seal?.sourceRevision !== revision ||
    seal?.manifestSha256 !== manifestSha256 || Number.isNaN(Date.parse(seal?.sealedAt))) {
  fail("release seal does not match manifest");
}
if (manifest?.sourceRevision !== revision) fail("release manifest sourceRevision does not match revision");

const applicationImages = new Set(["web", "api", "agent", "sandbox"]);
const requiredImages = [...applicationImages, "postgres", "redis"];
for (const name of requiredImages) {
  const image = manifest?.images?.[name]?.image;
  if (typeof image !== "string" || !/@sha256:[a-f0-9]{64}$/.test(image)) {
    fail(`${name} image is not pinned by registry digest`);
  }
  if (applicationImages.has(name) && !image.toLowerCase().startsWith(`${acrRepositoryPrefix.toLowerCase()}/`)) {
    fail(`${name} image is outside the configured ACR namespace`);
  }
}

process.stdout.write(`CN_PROMOTION_VERIFIED revision=${revision}\n`);
