import { describe, expect, it, vi } from "vitest";
import { resolveEntityDisplay } from "@repo/contracts/entity-localization";
import { localizeAuthorizedItems } from "../../src/application/localization/localize-authorized-items";
import type { EntityLocalizationRepository } from "../../src/application/localization/entity-localization";

describe("localized directory projection after authorization", () => {
  const rows = [{ agentId: "allowed", versionId: "pinned-v1", name: "原文", role: "原职责" }];
  const display = resolveEntityDisplay({ orgId: "org", entityId: "allowed", kind: "agent", revision: "v1", locale: "en", fields: { name: "English" } }, "en");
  it("reads exactly the disclosed IDs once and keeps source fields and version coordinates", async () => {
    const displays = vi.fn(async () => new Map([["allowed", display]]));
    const result = await localizeAuthorizedItems(rows, { orgId: "org", kind: "agent", locale: "en", idOf: row => row.agentId, repository: { displays } as unknown as EntityLocalizationRepository });
    expect(displays).toHaveBeenCalledTimes(1);
    expect(displays).toHaveBeenCalledWith("org", "agent", ["allowed"], "en");
    expect(result[0]).toMatchObject({ agentId: "allowed", versionId: "pinned-v1", name: "原文", role: "原职责", display: { fields: { name: { value: "English" } } } });
    expect(rows[0]).not.toHaveProperty("display");
  });
  it("preserves legacy responses when locale is omitted and avoids queries for empty lists", async () => {
    const displays = vi.fn();
    const options = { orgId: "org", kind: "agent" as const, idOf: (row: typeof rows[number]) => row.agentId, repository: { displays } as unknown as EntityLocalizationRepository };
    expect(await localizeAuthorizedItems(rows, options)).toBe(rows);
    expect(await localizeAuthorizedItems([], { ...options, locale: "en" })).toEqual([]);
    expect(displays).not.toHaveBeenCalled();
  });
  it("refuses to attach copy from a different published version", async () => {
    const result = await localizeAuthorizedItems(rows, {
      orgId: "org", kind: "agent", locale: "en", idOf: row => row.agentId, versionOf: row => row.versionId,
      repository: { displays: async () => new Map([["allowed", display]]) } as unknown as EntityLocalizationRepository,
    });
    expect(result[0]).not.toHaveProperty("display");
    expect(result[0]?.versionId).toBe("pinned-v1");
  });
});
