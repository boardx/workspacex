/**
 * A skill draft can come from the canonical persisted attachment convention or
 * from the filename currently produced by the model-facing skill creation flow.
 * Keep this classifier shared by message attachments and agent-run outputs so the
 * same file does not change meaning when the page hydrates.
 */
export function isSkillDraftFile(filename: string, mime: string | null | undefined): boolean {
  const normalizedMime = mime?.split(";", 1)[0]?.trim().toLowerCase();
  if (normalizedMime !== "application/json") return false;

  const normalizedName = filename.trim().toLowerCase();
  return normalizedName.endsWith(".skill.json") || normalizedName.endsWith("-skill-draft.json");
}
