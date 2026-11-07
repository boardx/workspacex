/** Private operational metrics only: no prompts, evidence, responses or reasoning. */
export interface ReportPerformanceEvent {
  stage: string;
  sectionId?: string;
  durationMs: number;
  failed: boolean;
  inputCharacters?: number;
  outputCharacters?: number;
}
export type ReportPerformanceSink = (event: ReportPerformanceEvent) => void;
export function reportPerformance(sink?: ReportPerformanceSink) {
  const started = performance.now();
  const seen = new Set<string>();
  const record = (event: ReportPerformanceEvent) => { try { sink?.(event); } catch { /* Diagnostics cannot fail a research task. */ } };
  return {
    record,
    milestone(stage: string, failed = false) {
      if (seen.has(stage)) return;
      seen.add(stage);
      record({ stage, failed, durationMs: Math.max(0, performance.now() - started) });
    },
  };
}
