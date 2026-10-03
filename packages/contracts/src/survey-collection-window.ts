export const SURVEY_COLLECTION_DEFAULT_DAYS = 30;

export function isSurveyCollectionWindowValid(startsAt: string, expiresAt: string): boolean {
  const start = Date.parse(startsAt);
  const end = Date.parse(expiresAt);
  return Number.isFinite(start) && Number.isFinite(end) && start < end;
}

/** Shared collection boundary: opening is inclusive, closing is exclusive. */
export function surveyCollectionAccessError(
  publication: { status: "collecting" | "closed"; startsAt?: string; expiresAt: string },
  now = Date.now(),
): "closed" | "expired" | "not_started" | null {
  if (publication.status !== "collecting") return "closed";
  const end = Date.parse(publication.expiresAt);
  const start = publication.startsAt === undefined ? null : Date.parse(publication.startsAt);
  if (!Number.isFinite(end) || (start !== null && !Number.isFinite(start)) || end <= now) return "expired";
  if (start !== null && start > now) return "not_started";
  return null;
}
