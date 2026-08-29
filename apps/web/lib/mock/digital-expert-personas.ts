import type { DigitalExpertCatalogRow } from "@/lib/interview-api";
import personaDatabase from "./experts-persona.json";

export const MOCK_EXPERT_ID_PREFIX = "mock-persona:";

interface PersonaSource {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly specialty: string;
  readonly bio: string;
  readonly personality: { readonly locations: string };
  readonly typical_advice: string;
}

export interface MockDigitalExpertPersona extends DigitalExpertCatalogRow {}

/**
 * Complete temporary projection of the supplied legacy `experts_persona.json`.
 * The source declares 102 total, while its category arrays currently contain 97 unique rows;
 * we display every concrete row rather than inventing the missing five.
 */
export const MOCK_DIGITAL_EXPERTS: readonly MockDigitalExpertPersona[] = Object.values(
  personaDatabase.experts_database.categories,
).flatMap((group) => (group.experts as readonly PersonaSource[]).map(toCatalogRow));

export const MOCK_EXPERT_CATEGORIES = Array.from(
  new Set(MOCK_DIGITAL_EXPERTS.map((expert) => expert.category)),
);

export function findMockDigitalExpert(expertId: string): MockDigitalExpertPersona | undefined {
  return MOCK_DIGITAL_EXPERTS.find((expert) => expert.expertId === expertId);
}

/** Project the static source through the same complete profile contract used by generated experts. */
export function toDigitalExpertCatalogRow(expert: MockDigitalExpertPersona): DigitalExpertCatalogRow {
  return {
    expertId: expert.expertId,
    agentDefinitionId: expert.agentDefinitionId,
    agentVersion: expert.agentVersion,
    initials: expert.initials,
    displayName: expert.displayName,
    role: expert.role,
    domains: expert.domains,
    materialContextPackId: expert.materialContextPackId,
    materialVersion: expert.materialVersion,
    materialBoundary: expert.materialBoundary,
    exploratory: expert.exploratory,
    category: expert.category,
    bio: expert.bio,
    location: expert.location,
    typicalAdvice: expert.typicalAdvice,
  };
}

function toCatalogRow(source: PersonaSource): MockDigitalExpertPersona {
  return {
    expertId: `${MOCK_EXPERT_ID_PREFIX}${source.id}`,
    agentDefinitionId: `mock-agent-definition:${source.id}`,
    agentVersion: "experts-persona-json:v1",
    initials: source.name.replace(/[・\s/]/g, "").slice(0, 2).toUpperCase(),
    displayName: source.name,
    role: source.specialty.replace(/\s+/g, " ").trim(),
    domains: [source.category],
    materialContextPackId: null,
    materialVersion: null,
    materialBoundary: "来自 experts_persona.json 的临时 Mock 档案，不作为真实证据",
    exploratory: true,
    category: source.category,
    bio: source.bio.replace(/\s+/g, " ").trim(),
    location: source.personality.locations,
    typicalAdvice: source.typical_advice,
  };
}
