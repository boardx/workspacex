// Read-only diagnosis of the baseline gate's source-root omission; not a gate replacement.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { checkTestidGate, listFiles, SOURCE_ROOTS, SOURCE_EXTS } from '../../../../../.harness/scripts/lint-e2e-testid-gate.mjs';
const spec = 'apps/web/e2e/aidt-local-persistence.spec.ts';
const base = execFileSync('git', ['show', `15ca37c4d:${spec}`], { encoding: 'utf8' });
const current = readFileSync(spec, 'utf8');
const read = path => [path, readFileSync(path, 'utf8')];
const sources = SOURCE_ROOTS.flatMap(root => listFiles(root, SOURCE_EXTS)).map(read);
const withFeatures = [...sources, ...listFiles('apps/web/features', SOURCE_EXTS).map(read)];
const a2Path = 'apps/web/features/aidt/components/project-aidt-chat.tsx';
const a2Commit = '5fd28e0108e33b2b653aa343cea59813e56ed245';
const a2Source = execFileSync('git', ['show', `${a2Commit}:${a2Path}`], { encoding: 'utf8' });
const result = (text, source) => {
  const checked = checkTestidGate([[spec, text]], source);
  return { ok: checked.ok, checked: checked.checked, skipped: checked.skipped, missing: [...new Set(checked.dangling.map(ref => ref.testid))], failures: checked.failures };
};
const report = { baseline: '15ca37c4d', sourceRoots: SOURCE_ROOTS, baselineCanonicalGate: result(base, sources), currentCanonicalGate: result(current, sources), diagnosticOnlyIncludingFeatures: result(current, withFeatures), integrationDependency: a2Commit, diagnosticWithA2Host: result(current, [...withFeatures, [a2Path, a2Source]]), note: 'No gate/config mutation or exemptions. Including features/A2 is diagnosis only; global canonical gate remains failed until separately fixed. Native Chat projection assertions require the A2 host plus root prop wiring.' };
writeFileSync('docs/evidence/aidt-native/completion-20261116/a6/testid-scope-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ baseline: report.baselineCanonicalGate.ok, current: report.currentCanonicalGate.ok, diagnosticIncludingFeatures: report.diagnosticOnlyIncludingFeatures.ok, diagnosticWithA2Host: report.diagnosticWithA2Host.ok, baselineMissing: report.baselineCanonicalGate.missing.length, currentMissing: report.currentCanonicalGate.missing.length }, null, 2));
