#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function fail(message) {
  process.stderr.write(`CN_PROMOTION_REJECTED: ${message}\n`);
  process.exit(1);
}

const [revision, manifestPath, acrRepositoryPrefix, mainRef = "origin/main", cnRef = "origin/main-cn"] = process.argv.slice(2);
if (!revision || !manifestPath || !acrRepositoryPrefix || process.argv.length > 7) {
  fail("usage: verify-cn-promotion.mjs <revision> <manifest> <acr-repository-prefix> [main-ref] [cn-ref]");
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

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  fail("release manifest is missing or invalid JSON");
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
