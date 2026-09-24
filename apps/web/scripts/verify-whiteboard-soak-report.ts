import { readFile } from 'node:fs/promises';
import { isAcceptanceConfig, SoakReportSchema } from '../e2e/support/whiteboard-collaboration-soak';

const file = process.env.WHITEBOARD_SOAK_REPORT ?? 'test-results/whiteboard-collaboration-soak/report.json';
const report = SoakReportSchema.parse(JSON.parse(await readFile(file, 'utf8')));
const expectedSha = process.env.GITHUB_SHA;
if (report.status !== 'accepted') throw new Error(`Board soak did not produce acceptance evidence: ${String(report.status)}`);
if (!isAcceptanceConfig(report.config)) throw new Error('Board soak used diagnostic thresholds and cannot produce acceptance evidence');
if (report.failure !== null) throw new Error(`Board soak report contains a failure: ${report.failure}`);
if (expectedSha && report.exactSha !== expectedSha.toLowerCase()) throw new Error(`Board soak SHA mismatch: ${report.exactSha} != ${expectedSha}`);
if (!report.analysis.accepted) throw new Error('Board soak analysis is not accepted');
if (report.collaborationDurationMs < report.config.durationMs) throw new Error('Board soak did not run for the declared collaboration duration');
console.log(`Board collaboration soak accepted at ${report.exactSha}`);
