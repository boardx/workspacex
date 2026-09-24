import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repo = readFileSync(
  "src/infrastructure/whiteboard/pg-mural-credential-repository.ts",
  "utf8",
);
const migration = readFileSync(
  "migrations/20260924000900_whiteboard_mural_direct_import.sql",
  "utf8",
);
const publicSurface = [
  "src/interface/controllers/whiteboard-mural.controller.ts",
  "src/application/whiteboard/mural-direct-import.ts",
]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

describe("Mural credential repository boundary", () => {
  it("keeps every method tenant-scoped and every credential/state query actor-scoped", () => {
    expect((repo.match(/withTenant\(/g) ?? []).length).toBe(7);
    for (const sql of repo.match(/`[^`]+`/g) ?? []) {
      if (!/whiteboard_mural_(?:oauth_states|credentials)/.test(sql)) continue;
      expect(sql).toMatch(/org_id=\$1|org_id,actor_id/);
      expect(sql).toMatch(/actor_id=\$2|org_id,actor_id/);
    }
    expect(repo).toMatch(/revoked_at IS NULL/);
    expect(repo).toMatch(/consumed_at IS NULL AND expires_at>\$4/);
    expect(repo).not.toMatch(/access_token|refresh_token|client_secret/i);
  });
  it("stores ciphertext only and makes RLS/grants explicit and tenant-local", () => {
    expect(migration).toContain("sealed_credentials text NOT NULL");
    expect(migration).not.toMatch(/access_token|refresh_token|client_secret/i);
    for (const table of [
      "whiteboard_mural_oauth_states",
      "whiteboard_mural_credentials",
      "whiteboard_mural_audit",
    ]) {
      expect(migration).toContain(
        `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`,
      );
      expect(migration).toContain(
        `org_id=current_setting('app.current_org',true)`,
      );
    }
    expect(migration).toContain(
      "REFERENCES organizations(id) ON DELETE CASCADE",
    );
    expect(migration).toContain(
      "REVOKE ALL ON whiteboard_mural_oauth_states,whiteboard_mural_credentials,whiteboard_mural_audit FROM app_rw",
    );
    expect(publicSurface).not.toMatch(/console\.(?:log|info|warn|error)/);
    expect(
      migration.match(
        /CREATE TABLE IF NOT EXISTS whiteboard_mural_audit[\s\S]*?\);/,
      )?.[0],
    ).not.toMatch(/sealed|token|secret|credential/i);
  });
});
