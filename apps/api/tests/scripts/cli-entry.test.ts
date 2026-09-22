import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isCliEntry } from "../../scripts/cli-entry";

describe("isCliEntry", () => {
  const withSpace = "/Applications/WorkspaceX Local.app/Contents/Resources/bundle/apps/api/scripts/backfill-platform-org.ts";
  const plain = "/srv/workspacex/apps/api/scripts/backfill-platform-org.ts";

  it("recognises the entry script when the path contains a space (the literal comparison did not)", () => {
    const moduleUrl = pathToFileURL(withSpace).href;
    expect(moduleUrl).toContain("%20");
    expect(`file://${withSpace}` === moduleUrl).toBe(false); // the old guard: silently false
    expect(isCliEntry(moduleUrl, withSpace)).toBe(true);
  });

  it("recognises a plain path", () => {
    expect(isCliEntry(pathToFileURL(plain).href, plain)).toBe(true);
  });

  it("is false for a module that was merely imported by the entry script", () => {
    const imported = pathToFileURL("/srv/workspacex/apps/api/scripts/cli-entry.ts").href;
    expect(isCliEntry(imported, plain)).toBe(false);
  });

  it("is false without an argv[1]", () => {
    expect(isCliEntry(pathToFileURL(plain).href, undefined)).toBe(false);
  });
});
