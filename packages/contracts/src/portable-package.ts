import { z } from "zod";
import { SkillStarterPackV2, AgentStarterPackV2, SkillStarterImportResult, AgentStarterImportResult } from "./wave2-runtime";

const coordinates = { idempotencyKey: z.string().min(1).max(255), expectedOrgId: z.string().min(1).max(255).optional() };
export const DisplayUpdateOffer = z.object({ metadataVersion: z.string().min(1), available: z.boolean(), installedCount: z.number().int().nonnegative() }).strict();
export const DisplayUpdateResult = z.object({ metadataVersion: z.string().min(1), updatedEntities: z.number().int().nonnegative(), skippedEntities: z.number().int().nonnegative(), appliedAt: z.string().datetime(), replayed: z.boolean() }).strict();
export const DisplayUpdateInput = z.object({ ...coordinates, expectedOrgId: z.string().min(1), expectedMetadataVersion: z.string().min(1) }).strict();
/** A user-supplied package imports as org-owned. Official provenance is reserved
 * for the existing configured server-side official package source. */
export const operations = {
  importSkill: { method: "POST", path: "/admin/skills/portable-imports", in: z.object({ ...coordinates, pack: SkillStarterPackV2 }).strict(), out: SkillStarterImportResult },
  importAgent: { method: "POST", path: "/admin/agents/portable-imports", in: z.object({ ...coordinates, pack: AgentStarterPackV2 }).strict(), out: AgentStarterImportResult },
  exportSkill: { method: "GET", path: "/admin/skills/:entityId/portable-package", out: SkillStarterPackV2 },
  exportAgent: { method: "GET", path: "/admin/agents/:entityId/portable-package", out: AgentStarterPackV2 },
  displayUpdateOffer: { method: "GET", path: "/admin/entity-display-updates/offer", out: DisplayUpdateOffer },
  applyDisplayUpdate: { method: "POST", path: "/admin/entity-display-updates", in: DisplayUpdateInput, out: DisplayUpdateResult },
} as const;
