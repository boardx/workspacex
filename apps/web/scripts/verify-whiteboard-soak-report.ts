import { readFile } from 'node:fs/promises';
import { isAcceptanceConfig, recomputeReport, SoakReportSchema, type SoakReport } from '../e2e/support/whiteboard-collaboration-soak';

async function verifyWhiteboardSoakReport(file: string, expectedSha?: string): Promise<void> {
  const report = SoakReportSchema.parse(JSON.parse(await readFile(file, 'utf8'))) as SoakReport;
  const recomputed = recomputeReport(report);
  if (report.status !== 'accepted') throw new Error(`Board soak did not produce acceptance evidence: ${String(report.status)}`);
  if (!isAcceptanceConfig(report.config)) throw new Error('Board soak used diagnostic thresholds and cannot produce acceptance evidence');
  if (report.failure !== null) throw new Error(`Board soak report contains a failure: ${report.failure}`);
  if (expectedSha && report.exactSha !== expectedSha.toLowerCase()) throw new Error(`Board soak SHA mismatch: ${report.exactSha} != ${expectedSha}`);
  if (!recomputed.analysis.accepted || recomputed.status !== 'accepted') throw new Error(`Board soak raw evidence is not accepted: ${JSON.stringify(recomputed.analysis)}`);
  if (JSON.stringify(report.analysis) !== JSON.stringify(recomputed.analysis)) throw new Error('Board soak recorded analysis does not match raw evidence');
}

async function main(): Promise<void> {
  const file = process.env.WHITEBOARD_SOAK_REPORT ?? 'test-results/whiteboard-collaboration-soak/report.json';
  await verifyWhiteboardSoakReport(file, process.env.GITHUB_SHA);
  const report = SoakReportSchema.parse(JSON.parse(await readFile(file, 'utf8'))) as SoakReport;
  console.log(`Board collaboration soak accepted at ${report.exactSha}`);
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
