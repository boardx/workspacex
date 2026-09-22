/** MIGRATIONS_DIR must be a filesystem path, not a URL pathname: spaces in the install path
 *  ("/Applications/WorkspaceX Local.app/...") were percent-encoded and the migrator ENOENT'd. */
import { describe, expect, it } from "vitest";
import { migrationsDirFrom, MIGRATIONS_DIR } from "../../src/infrastructure/db/migrator";

describe("migrationsDirFrom", () => {
  it("decodes percent-encoded characters of the module URL (space in the app bundle path)", () => {
    const dir = migrationsDirFrom("file:///Applications/WorkspaceX%20Local.app/Contents/Resources/bundle/apps/api/src/infrastructure/db/migrator.ts");
    expect(dir).toBe("/Applications/WorkspaceX Local.app/Contents/Resources/bundle/apps/api/migrations/");
    expect(dir).not.toContain("%20");
  });
  it("the live constant points at the repo's migrations directory", () => {
    expect(MIGRATIONS_DIR.endsWith("/apps/api/migrations/")).toBe(true);
  });
});
