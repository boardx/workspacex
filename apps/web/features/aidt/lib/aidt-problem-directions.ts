export type AidtProblemDirection = { id: string; title: string; source: "group" | "ai" };

export function readAidtProblemDirections(value?: string): AidtProblemDirection[] {
  if (!value) return [];
  try {
    const rows: unknown = JSON.parse(value);
    if (!Array.isArray(rows)) return [];
    return rows.filter((row): row is AidtProblemDirection => row && typeof row.id === "string" && typeof row.title === "string" && (row.source === "group" || row.source === "ai"));
  } catch {
    return [];
  }
}
