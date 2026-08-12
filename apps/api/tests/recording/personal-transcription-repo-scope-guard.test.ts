import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryPath = fileURLToPath(
  new URL("../../src/infrastructure/recording/pg-personal-transcription-repository.ts", import.meta.url),
);
const portPath = fileURLToPath(
  new URL("../../src/application/recording/personal-transcription-ports.ts", import.meta.url),
);
const repository = readFileSync(repositoryPath, "utf8");
const port = readFileSync(portPath, "utf8");

const SQL_REF = /\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi;

describe("personal transcription repository keeps its owner-only exemption true", () => {
  it("names only personal metadata, capture sessions and tracks", () => {
    const tables = [...repository.matchAll(SQL_REF)].map((match) => match[1]!.toLowerCase());
    expect(tables.length).toBeGreaterThan(5);
    expect([...new Set(tables)].sort()).toEqual([
      "personal_transcriptions",
      "recording_sessions",
      "recording_tracks",
    ]);
  });

  it("never escapes tenant scope and exposes no owner-less read port", () => {
    expect(repository).not.toContain("withoutTenant");
    expect(repository).toContain("withTenant");
    expect(port.match(/ownerUserId: string/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(port).not.toMatch(/findById|readById|listAll/);
  });

  it("applies the owner predicate to every metadata and capture read", () => {
    expect(repository).toContain("p.owner_user_id = $2");
    expect(repository).toContain("p.owner_user_id=$3");
    expect(repository).toContain("p.owner_user_id=$4");
    expect(repository).not.toContain("recording_segments");
  });
});
