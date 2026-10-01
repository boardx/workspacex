/** Machine contract for S003, translated from the authored requirement §5/§6.
 * Package frontmatter is generated from these schemas, never a Markdown $ref.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const Scope = z.enum(["current-files", "organization-index", "organization-hybrid"]);
const QueryType = z.enum(["decision", "status", "locate", "who-knows", "policy", "timeline", "exists"]);
const Timestamp = z.string().datetime({ offset: true });
export const S003InputSchema = z.object({
  question: z.string().min(1), mode: z.enum(["evidence", "dedupe"]), queryType: QueryType.optional(),
  projectIds: z.array(z.string()).optional(), scopes: z.array(Scope).optional(),
  timeWindow: z.object({ from: Timestamp.optional(), to: Timestamp.optional() }).strict().optional(),
  researchPlanItemRef: z.string().optional(), maxHitsPerItem: z.number().int().min(1).max(10).optional(),
}).strict();
const Hit = z.object({
  hitId: z.string(), sourceId: z.string(), versionId: z.string(), citationAnchor: z.string(), accessibleAt: Timestamp,
  sourceTimestamp: Timestamp.optional(), relation: z.enum(["supports", "contradicts", "mentions-only", "superseded"]),
  supersededBy: z.string().optional(), excerpt: z.string().max(400), owner: z.string().optional(),
}).strict();
const OutputShape = z.object({
  question: z.string(), queryType: QueryType, queryTypeInferred: z.boolean(),
  scopeDeclared: z.object({ scopes: z.array(Scope), projectIds: z.array(z.string()), declaredAt: Timestamp }).strict(),
  items: z.array(z.object({
    itemId: z.string(), claimToVerify: z.string(),
    queriesRun: z.array(z.object({ scope: Scope, query: z.string(), variantOf: z.string().optional(),
      hitCount: z.number().int().nonnegative(), status: z.enum(["ok", "denied", "unavailable", "not-configured"]),
    }).strict()),
    status: z.enum(["answered", "conflicting", "not-found-in-scope", "blocked"]), hits: z.array(Hit),
  }).strict()).max(6),
  duplicateOf: z.array(z.object({ sourceId: z.string(), versionId: z.string(), similarityReason: z.string() }).strict()).optional(),
  coverageGaps: z.array(z.object({ itemId: z.string(),
    reason: z.enum(["permission-denied", "retrieval-unavailable", "scope-not-indexed", "hybrid-not-configured", "none-in-scope"]),
    suggestion: z.string(),
  }).strict()),
  injectionFlags: z.array(z.object({ hitId: z.string(), note: z.string() }).strict()),
}).strict();
export const S003OutputSchema = OutputShape.superRefine((ledger, context) => {
  if (ledger.queryType !== "who-knows") return;
  ledger.items.forEach((item, i) => item.hits.forEach((hit, h) => {
    if (hit.owner === undefined) context.addIssue({ code: "custom", path: ["items", i, "hits", h, "owner"], message: "owner is required for who-knows queries" });
  }));
});
export const s003MachineSchemas = {
  inputSchema: zodToJsonSchema(S003InputSchema, { $refStrategy: "none" }),
  outputSchema: {
    ...zodToJsonSchema(OutputShape, { $refStrategy: "none" }),
    allOf: [{
      if: { properties: { queryType: { const: "who-knows" } }, required: ["queryType"] },
      then: { properties: { items: { items: { properties: { hits: { items: { required: ["owner"] } } } } } } },
    }],
  },
};
