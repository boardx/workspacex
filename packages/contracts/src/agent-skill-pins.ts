/** #3260: read the current model-A pin head without deriving it from historical runs.
 * An empty list means the existing runtime organization-default behavior, not deny-all.
 */
import { z } from "zod";
export const getAgentSkillPins = {
  method: "GET",
  path: "/admin/agents/:agentId/skill-pins",
  in: z.object({ agentId: z.string().min(1) }).strict(),
  out: z.object({
    agentId: z.string(), publishedVersionId: z.string(),
    pins: z.array(z.object({ skillId: z.string(), versionId: z.string() }).strict()),
  }).strict(),
  err: ["ROLE_INSUFFICIENT", "AGENT_NOT_FOUND", "AGENT_NOT_PUBLISHED", "SKILL_VERSION_NOT_FOUND"] as const,
} as const;
