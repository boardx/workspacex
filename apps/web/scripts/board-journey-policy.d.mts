export {connectionGestureMetric} from './board-connection-gesture-metric.mjs';

export function validateJourneyArtifact(report: unknown, sha: string, context: unknown): Promise<{
  valid: boolean;
  failures: string[];
  pending: string[];
  budgetStatus: 'pending-independent-acceptance';
  score: null;
}>;
