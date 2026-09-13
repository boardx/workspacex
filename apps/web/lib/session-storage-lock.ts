/** All same-origin session writers participate; never hold this lock across network work. */
export const SESSION_STORAGE_LOCK = "wsx.session-storage";

export class SessionReplacementSupersededError extends Error {
  constructor() {
    super("session_replacement_superseded");
    this.name = "SessionReplacementSupersededError";
  }
}

export async function withSessionStorageLock<T>(
  operation: () => T,
  requireCrossTabLock = false,
): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(SESSION_STORAGE_LOCK, operation);
  }
  // Explicit password login remains available on older clients, but automatic account
  // replacement must fail closed: a local promise queue cannot synchronize other tabs.
  if (requireCrossTabLock) throw new Error("cross_tab_session_lock_unavailable");
  return operation();
}
