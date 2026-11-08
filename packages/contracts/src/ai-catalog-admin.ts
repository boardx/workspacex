import { z } from "zod";
import { operations as skillOperations } from "./skills";
import { DeclarativeContract } from "./skills";

export const PLATFORM_CATALOG_ORG_ID = "org-platform";
const Id = z.string().min(1).max(255);
export const Kind = z.enum(["agent", "skill"]);
export const Entry = z
  .object({
    orgId: Id,
    id: Id,
    kind: Kind,
    entityType: z.enum(["agent", "skill", "skill-contract"]).optional(),
    name: z.string(),
    description: z.string(),
    avatarUrl: z.string().nullable(),
    avatarKey: z.string().nullable().optional(),
    versionId: Id.nullable(),
    scope: z.enum(["organization", "public"]),
    published: z.boolean(),
    hasDraft: z.boolean().optional(),
    enabled: z.boolean(),
  })
  .strict();
export const Page = z
  .object({ entries: z.array(Entry), nextCursor: z.string().nullable() })
  .strict();
export const List = z
  .object({
    kind: Kind,
    orgId: Id.optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export const Enable = z
  .object({
    kind: Kind,
    id: Id,
    versionId: Id,
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();
export const EnableResult = z
  .object({
    kind: Kind,
    id: Id,
    versionId: Id,
    originId: Id,
    originVersionId: Id,
  })
  .strict();
export const AgentWrite = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000),
    instructions: z.string().max(100000),
    modelId: Id.nullable(),
  })
  .strict();
export const SkillWrite = z
  .object({
    name: z.string().trim().min(1).max(200),
    stableName: z.string().trim().min(1).max(200),
    description: z.string().max(2000),
    content: z.string().min(1).max(1000000),
  })
  .strict();
export const Write = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent"), input: AgentWrite }).strict(),
  z.object({ kind: z.literal("skill"), input: SkillWrite }).strict(),
]);

export const LegacySkillDefinition = z
  .object({
    kind: z.literal("skill-contract"),
    input: z
      .object({
        name: z.string(),
        description: z.string(),
        source: z.string(),
        status: z.string(),
        versionId: Id.nullable(),
        modelRef: z.string().nullable(),
        versionState: z.string().nullable(),
        declaration: DeclarativeContract.nullable(),
      })
      .strict(),
  })
  .strict();
export const Detail = z
  .object({ entry: Entry, definition: z.union([Write, LegacySkillDefinition]) })
  .strict();
export const operations = {
  listPlatform: {
    method: "GET",
    path: "/platform/ai-catalog",
    in: List,
    out: Page,
  },
  listPublic: {
    method: "GET",
    path: "/organizations/:orgId/public-ai-catalog",
    in: List.omit({ orgId: true }),
    out: Page,
  },
  enable: {
    method: "POST",
    path: "/organizations/:orgId/public-ai-catalog/enable",
    in: Enable,
    out: EnableResult,
  },
  detail: {
    method: "GET",
    path: "/platform/organizations/:orgId/ai-catalog/:kind/:id",
    in: z
      .object({
        entityType: z.enum(["agent", "skill", "skill-contract"]).optional(),
      })
      .strict(),
    out: Detail,
  },
  create: {
    method: "POST",
    path: "/platform/organizations/:orgId/ai-catalog",
    in: Write,
    out: Entry,
  },
  update: {
    method: "PATCH",
    path: "/platform/organizations/:orgId/ai-catalog/:kind/:id",
    in: Write,
    out: Entry,
  },
  publish: {
    method: "POST",
    path: "/platform/organizations/:orgId/ai-catalog/:kind/:id/publish",
    in: z.object({}).strict(),
    out: Entry,
  },
  disable: {
    method: "POST",
    path: "/platform/organizations/:orgId/ai-catalog/:kind/:id/disable",
    in: z.object({}).strict(),
    out: Entry,
  },
} as const;
export const ErrorCode = z.enum([
  "CATALOG_ENTRY_NOT_FOUND",
  "CATALOG_VERSION_CONFLICT",
  "CATALOG_MODEL_CHANGE_REQUIRES_VALIDATION",
  "CATALOG_ENTRY_NOT_DRAFT",
  "CATALOG_NOT_FOUND",
  "CATALOG_DEPENDENCIES_REQUIRE_INSTALLATION",
  "CATALOG_NAME_CONFLICT",
  "CATALOG_PUBLISH_REJECTED",
  "AGENT_NOT_DRAFT",
  "AGENT_NOT_TOOLLESS",
  "AGENT_VISIBILITY_UNSUPPORTED",
  "AGENT_NO_EXECUTABLE_DEFINITION",
]);
export const ErrorBody = z.object({ reasonCode: ErrorCode }).strict();

export const legacySkillOperations = {
  scan: {
    ...skillOperations.runSecurityScan,
    path: "/platform/organizations/:orgId/skill-versions/:versionId/security-scan",
  },
  submit: {
    ...skillOperations.submitSkillForReview,
    path: "/platform/organizations/:orgId/skill-versions/:versionId/submit",
  },
  review: {
    ...skillOperations.reviewSkillVersion,
    path: "/platform/organizations/:orgId/skill-versions/:versionId/review",
  },
} as const;
