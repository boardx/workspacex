// No pg, migrator, Node URL or environment-dependent imports: the global file
// setup must be inert even in jsdom and before tests install their own mocks.
const owned = new Map<string, () => Promise<void>>();

export function trackSeededOrganization(orgId: string, remove: () => Promise<void>): void {
  owned.set(orgId, remove);
}

export async function cleanupSeededOrganizations(): Promise<void> {
  for (const [id, remove] of [...owned]) {
    await remove();
    // Keep ownership on failure for a retry, or if a new fixture was registered
    // during cleanup. Only successfully removed, unchanged entries are forgotten.
    if (owned.get(id) === remove) owned.delete(id);
  }
}
