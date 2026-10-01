const key = (surveyId: string) => `survey:pending-ai-import:${surveyId}`;

export function markPendingAiImport(surveyId: string): void {
  try { window.localStorage.setItem(key(surveyId), "1"); } catch { /* Private browsing can disable storage. */ }
}

export function hasPendingAiImport(surveyId: string): boolean {
  try { return window.localStorage.getItem(key(surveyId)) === "1"; } catch { return false; }
}

export function clearPendingAiImport(surveyId: string): void {
  try { window.localStorage.removeItem(key(surveyId)); } catch { /* See above. */ }
}
