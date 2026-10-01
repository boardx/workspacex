import personaDatabase from "./experts-persona.json";

export interface InterviewPersona {
  id: string;
  name: string;
  category: string;
  specialty: string;
  bio: string;
  personality: { locations: string; age: number; occupation: string };
  goals: string[];
  interests: string[];
  pain_points: string[];
  motivations: string[];
  influences: string[];
  service_value: string;
  typical_advice: string;
}

/** Concrete source rows only: the legacy metadata says 102, but contains 97 records. */
export const INTERVIEW_PERSONAS: readonly InterviewPersona[] = Object.values(
  personaDatabase.experts_database.categories,
).flatMap((category) => category.experts);

export const INTERVIEW_PERSONA_CATEGORIES = Object.keys(personaDatabase.experts_database.categories);

export function personaAnchorId(persona: InterviewPersona): string {
  return `persona-${persona.id}`;
}
