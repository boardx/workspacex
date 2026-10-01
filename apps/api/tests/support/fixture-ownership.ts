// No pg, migrator, Node URL or environment-dependent imports: the global file
// setup must be inert even in jsdom and before tests install their own mocks.
const owned = new Map<string, () => Promise<void>>();

export function trackSeededOrganization(orgId: string, remove: () => Promise<void>): void {
  owned.set(orgId, remove);
}

export async function cleanupSeededOrganizations(): Promise<void> {
  for (const [id, remove] of [...owned]) {
    for (let attempt = 0; ; attempt++) {
      try {
        await remove();
        break;
      } catch (error) {
        // A PostgreSQL deadlock aborts the DELETE transaction in full. Background
        // run notifications may still be finishing after app.close(); retry only
        // that precise transient failure, at most three total attempts.
        if (attempt >= 2 || typeof error !== "object" || error === null
          || !("code" in error) || error.code !== "40P01") throw error;
        console.warn(`[fixture-cleanup] deadlock; retry ${attempt + 2}/3`);
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    // Keep ownership on failure for a retry, or if a new fixture was registered
    // during cleanup. Only successfully removed, unchanged entries are forgotten.
    if (owned.get(id) === remove) owned.delete(id);
  }
}
