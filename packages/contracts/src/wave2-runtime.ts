/**
 * Signed Wave 2 runtime delta (#409 / PR #426).
 *
 * This namespace is deliberately separate from the historical `skills` bundle: the human
 * signoff says the delta does not silently amend that bundle. HTTP DTOs, configured pack
 * manifests, backend validation, and the admin client all derive from this one source.
 */
import { z } from "zod";

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const PackCoordinate = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const StableName = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9-]*$/);

export const SkillStarterPackFile = z.object({
  path: z.string().min(1).max(512),
  mediaType: z.string().min(1).max(255),
  digest: Sha256,
  contentBase64: z.string().min(1),
}).strict();

export const SkillStarterPackEntry = z.object({
  stableName: StableName,
  name: z.string().min(1).max(255),
  semanticVersion: z.string().min(1).max(64),
  manifest: z.record(z.unknown()),
  files: z.array(SkillStarterPackFile).min(1),
}).strict();

export const UnsignedSkillStarterPack = z.object({
  schemaVersion: z.literal(1),
  packId: PackCoordinate,
  packVersion: PackCoordinate,
  skills: z.array(SkillStarterPackEntry).min(1),
}).strict();

export const SkillStarterPack = UnsignedSkillStarterPack.extend({
  packDigest: Sha256,
}).strict();

export const SkillStarterImportError = z.enum([
  "SKILL_STARTER_PACK_NOT_FOUND",
  "SKILL_STARTER_PACK_INVALID",
  "SKILL_STARTER_PACK_CONFLICT",
  "SKILL_STARTER_IMPORT_IDEMPOTENCY_CONFLICT",
  "SKILL_STARTER_IMPORT_ADMIN_REQUIRED",
]);

export const SkillStarterImportResult = z.object({
  importId: z.string(),
  packId: PackCoordinate,
  packVersion: PackCoordinate,
  packDigest: Sha256,
  status: z.literal("succeeded"),
  skillIds: z.array(z.string()),
  versionIds: z.array(z.string()),
  importedAt: z.string(),
}).strict();

export const AgentSkillVersionReference = z.object({
  versionId: z.string().min(1).max(255),
  digest: Sha256,
}).strict();

export const AgentStarterPackEntry = z.object({
  stableName: StableName,
  name: z.string().min(1).max(255),
  semanticVersion: z.string().min(1).max(64),
  instructions: z.string().min(1),
  instructionDigest: Sha256,
  skillVersions: z.array(AgentSkillVersionReference),
  modelProvider: z.string().min(1).max(128),
  modelId: z.string().min(1).max(255),
  toolPolicy: z.array(z.never()).max(0),
}).strict();

export const UnsignedAgentStarterPack = z.object({
  schemaVersion: z.literal(1),
  packId: PackCoordinate,
  packVersion: PackCoordinate,
  agents: z.array(AgentStarterPackEntry).min(1),
}).strict();

export const AgentStarterPack = UnsignedAgentStarterPack.extend({
  packDigest: Sha256,
}).strict();

export const AgentStarterImportError = z.enum([
  "AGENT_STARTER_PACK_NOT_FOUND",
  "AGENT_STARTER_PACK_INVALID",
  "AGENT_STARTER_PACK_CONFLICT",
  "AGENT_STARTER_IMPORT_IDEMPOTENCY_CONFLICT",
  "AGENT_STARTER_IMPORT_ADMIN_REQUIRED",
  "AGENT_STARTER_SKILL_VERSION_MISSING",
  "AGENT_STARTER_SKILL_VERSION_MISMATCH",
]);

export const AgentStarterImportResult = z.object({
  importId: z.string(),
  packId: PackCoordinate,
  packVersion: PackCoordinate,
  packDigest: Sha256,
  status: z.literal("succeeded"),
  agentIds: z.array(z.string()),
  versionIds: z.array(z.string()),
  importedAt: z.string(),
}).strict();

export const operations = {
  importSkillStarterPack: {
    method: "POST",
    path: "/admin/skills/starter-pack-imports",
    in: z.object({
      packId: PackCoordinate,
      packVersion: PackCoordinate,
      idempotencyKey: z.string().min(1).max(255),
    }).strict(),
    out: SkillStarterImportResult,
    err: SkillStarterImportError.options,
  },
  importAgentStarterPack: {
    method: "POST",
    path: "/admin/agents/starter-pack-imports",
    in: z.object({
      packId: PackCoordinate,
      packVersion: PackCoordinate,
      idempotencyKey: z.string().min(1).max(255),
    }).strict(),
    out: AgentStarterImportResult,
    err: AgentStarterImportError.options,
  },
} as const;
