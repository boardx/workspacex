import { z } from "zod";

/** First-party SVG illustrations (the interview expert picker offers exactly these). */
export const ILLUSTRATION_AVATAR_KEYS = [
  "person-1", "person-2", "person-3", "person-4", "person-5", "person-6",
  "person-7", "person-8", "person-9", "person-10", "person-11", "person-12",
  "person-13", "person-14", "person-15", "person-16", "person-17", "person-18",
  "person-19", "person-20", "person-21", "person-22", "person-23", "person-24", "robot",
] as const;
/**
 * First-party digital-human portraits (`dh-NN-<role-slug>`, NN = the "WorkspaceX Digital Humans —
 * 60 Role Avatars" grid number). Served as `apps/web/public/avatars/digital-humans/<key>.webp`;
 * which official role uses which portrait is declared once, in the API's official role pack seeds.
 */
export const DIGITAL_HUMAN_AVATAR_KEYS = [
  "dh-01-executive-strategy-partner", "dh-02-research-knowledge-analyst", "dh-03-product-manager",
  "dh-04-marketing-growth-manager", "dh-05-sales-representative", "dh-06-customer-success-specialist",
  "dh-07-project-operations-manager", "dh-08-finance-analyst", "dh-09-legal-compliance-analyst",
  "dh-10-hr-talent-specialist", "dh-11-design-thinking-expert", "dh-12-lean-kaizen-expert",
  "dh-13-six-sigma-quality-expert", "dh-14-business-process-reengineering-expert", "dh-15-agile-product-operating-model-coach",
  "dh-16-organizational-change-expert", "dh-17-decision-science-expert", "dh-18-ai-transformation-architect",
  "dh-19-manufacturing-operations-expert", "dh-20-supply-chain-procurement-expert", "dh-21-retail-e-commerce-expert",
  "dh-22-banking-financial-services-expert", "dh-23-insurance-claims-expert", "dh-24-healthcare-operations-expert",
  "dh-25-life-sciences-pharma-expert", "dh-26-education-learning-designer", "dh-27-real-estate-construction-expert",
  "dh-28-energy-utilities-expert", "dh-29-logistics-transportation-expert", "dh-30-government-public-service-expert",
  "dh-31-fp-a-analyst", "dh-32-accounting-specialist", "dh-33-treasury-analyst",
  "dh-34-procurement-specialist", "dh-35-supply-chain-planner", "dh-36-quality-engineer",
  "dh-37-manufacturing-planner", "dh-38-software-engineer", "dh-39-solution-architect",
  "dh-40-data-analyst", "dh-41-data-engineer", "dh-42-cybersecurity-analyst",
  "dh-43-ux-researcher", "dh-44-content-strategist", "dh-45-revenue-operations-analyst",
  "dh-46-customer-support-operations-specialist", "dh-47-learning-experience-designer", "dh-48-compliance-officer",
  "dh-49-business-analyst", "dh-50-process-analyst", "dh-51-credit-analyst",
  "dh-52-investment-analyst", "dh-53-risk-analyst", "dh-54-clinical-research-analyst",
  "dh-55-regulatory-affairs-specialist", "dh-56-medical-affairs-analyst", "dh-57-construction-project-analyst",
  "dh-58-real-estate-analyst", "dh-59-energy-analyst", "dh-60-sustainability-esg-analyst",
] as const;
/** The closed key set. SVG markup / URLs are never accepted as preference data. */
export const AVATAR_KEYS = [...ILLUSTRATION_AVATAR_KEYS, ...DIGITAL_HUMAN_AVATAR_KEYS] as const;
export const AvatarKey = z.enum(AVATAR_KEYS);
export const ExpertAvatarPreference = z.object({
  expertId: z.string().min(1).max(256), avatarKey: AvatarKey.nullable(), version: z.number().int().nonnegative(),
}).strict();
export const SaveExpertAvatarPreference = z.object({
  avatarKey: AvatarKey.nullable(), expectedVersion: z.number().int().nonnegative(),
}).strict();
export type ExpertAvatarPreference = z.infer<typeof ExpertAvatarPreference>;
export const ExpertAvatarContext = z.object({ interviewId: z.string().min(1).max(256), revisionId: z.string().min(1).max(256) }).strict();
export type ExpertAvatarContext = z.infer<typeof ExpertAvatarContext>;
export const SaveInterviewExpertAvatarPreference = SaveExpertAvatarPreference.extend({ revisionId: ExpertAvatarContext.shape.revisionId }).strict();
