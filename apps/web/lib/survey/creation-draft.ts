export interface SurveyCreationDraft {
  name: string;
  tags: string[];
  sourceModuleId?: string;
}

export function normalizeSurveyCreationDraft(input: unknown): SurveyCreationDraft | null {
  if (!input || typeof input !== "object") return null;
  const value = input as { name?: unknown; tags?: unknown; sourceModuleId?: unknown };
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) return null;

  const tags = Array.isArray(value.tags)
    ? [...new Set(value.tags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter(Boolean))]
    : [];
  const sourceModuleId = typeof value.sourceModuleId === "string" && value.sourceModuleId.trim()
    ? value.sourceModuleId.trim()
    : undefined;

  return sourceModuleId ? { name, tags, sourceModuleId } : { name, tags };
}

export function encodeSurveyCreationDraft(draft: SurveyCreationDraft): string {
  const normalized = normalizeSurveyCreationDraft(draft);
  if (!normalized) throw new Error("Survey creation draft requires a name");
  return JSON.stringify(normalized);
}

export function decodeSurveyCreationDraft(value?: string): SurveyCreationDraft | null {
  if (!value) return null;
  try {
    return normalizeSurveyCreationDraft(JSON.parse(value));
  } catch {
    return null;
  }
}
