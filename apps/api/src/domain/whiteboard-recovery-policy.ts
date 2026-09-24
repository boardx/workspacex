/** Single retention contract for server-issued Board quarantine access proofs. */
export const WHITEBOARD_RECOVERY_POLICY = {
  accessReceiptTtlMs: 30 * 24 * 60 * 60 * 1_000,
  inactiveReceiptRetentionMs: 90 * 24 * 60 * 60 * 1_000,
} as const;
