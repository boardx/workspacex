export const connectionGestureMetric: {name: 'connection-gestures-per-edge'; limit: 1};

export function validateJourneyArtifact(report: unknown, sha: string, context: unknown): Promise<{
  valid: boolean;
  failures: string[];
  pending: string[];
  budgetStatus: 'pending-independent-acceptance';
  score: null;
}>;
