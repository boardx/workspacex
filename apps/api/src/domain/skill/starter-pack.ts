import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { z } from "zod";
import { wave2Runtime } from "@repo/contracts";

export type SkillStarterPack = z.infer<typeof wave2Runtime.SkillStarterPack>;

export class InvalidSkillStarterPackError extends Error {
  constructor() {
    super("skill starter pack is invalid");
  }
}

export const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

function decodeBase64(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  const normalizedInput = value.replace(/=+$/, "");
  const normalizedOutput = decoded.toString("base64").replace(/=+$/, "");
  if (normalizedInput !== normalizedOutput) throw new InvalidSkillStarterPackError();
  return decoded;
}

function normalizedPath(path: string): string {
  if (path.includes("\\") || path.startsWith("/") || path.includes("\0")) {
    throw new InvalidSkillStarterPackError();
  }
  const normalized = posix.normalize(path);
  if (normalized !== path || normalized === "." || normalized.startsWith("../")) {
    throw new InvalidSkillStarterPackError();
  }
  return normalized;
}

export function verifySkillStarterPack(raw: unknown, expected: {
  readonly packId: string;
  readonly packVersion: string;
}): SkillStarterPack {
  const parsed = wave2Runtime.SkillStarterPack.safeParse(raw);
  if (!parsed.success) throw new InvalidSkillStarterPackError();
  const pack = parsed.data;
  if (pack.packId !== expected.packId || pack.packVersion !== expected.packVersion) {
    throw new InvalidSkillStarterPackError();
  }

  const unsigned = {
    schemaVersion: pack.schemaVersion,
    packId: pack.packId,
    packVersion: pack.packVersion,
    skills: pack.skills,
  };
  if (sha256(JSON.stringify(unsigned)) !== pack.packDigest) {
    throw new InvalidSkillStarterPackError();
  }

  const stableNames = new Set<string>();
  const displayNames = new Set<string>();
  for (const skill of pack.skills) {
    if (stableNames.has(skill.stableName) || displayNames.has(skill.name.toLocaleLowerCase())) {
      throw new InvalidSkillStarterPackError();
    }
    stableNames.add(skill.stableName);
    displayNames.add(skill.name.toLocaleLowerCase());

    const paths = new Set<string>();
    let rootCount = 0;
    for (const file of skill.files) {
      const path = normalizedPath(file.path);
      if (paths.has(path)) throw new InvalidSkillStarterPackError();
      paths.add(path);
      if (path === "SKILL.md") rootCount += 1;
      if (sha256(decodeBase64(file.contentBase64)) !== file.digest) {
        throw new InvalidSkillStarterPackError();
      }
    }
    if (rootCount !== 1) throw new InvalidSkillStarterPackError();
  }
  return pack;
}

export function importPayloadDigest(input: {
  readonly packId: string;
  readonly packVersion: string;
}): string {
  return sha256(JSON.stringify({ packId: input.packId, packVersion: input.packVersion }));
}

export function skillContentDigest(skill: SkillStarterPack["skills"][number]): string {
  return sha256(JSON.stringify({
    manifest: skill.manifest,
    files: skill.files.map(({ path, digest, mediaType }) => ({ path, digest, mediaType })),
  }));
}
