/** Fail-closed assembly of the independently executed full-base API suites. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { shardPlan, discoverCoverage } from './ci-api-shards.mjs';
const legacyRequired = ['verify-full-compile', 'base-api-plan', 'base-api-shards', 'base-api-exclusive'];
const hash = value => createHash('sha256').update(value).digest('hex');
export function assertPrerequisites(needs,event=process.env.GITHUB_EVENT_NAME) {
  if(!['merge_group','workflow_dispatch'].includes(event)) {
    if (!needs || Object.keys(needs).sort().join() !== [...legacyRequired].sort().join() || legacyRequired.some(name => needs[name]?.result !== 'success')) throw new Error('INCOMPLETE_BASE_PREREQUISITES');
    return;
  }
  const required=['base-api-plan','base-api-shards','base-api-exclusive','base-compile'];
  if(!needs||Object.keys(needs).sort().join()!==required.sort().join()||required.some(k=>needs[k]?.result!=='success'))throw new Error('INCOMPLETE_BASE_PREREQUISITES');
}
export function validateReport(report, expectedFiles) {
  if (report?.success !== true || !(report.numPassedTests > 0)
    || !(report.numTotalTests >= report.numPassedTests)
    || !Array.isArray(report.testResults) || !report.testResults.length
    || report.testResults.some(file => !['passed', 'skipped'].includes(file.status))) {
    throw new Error('INCOMPLETE_API_REPORT');
  }
  if (expectedFiles === undefined) return;
  if (typeof expectedFiles === 'number') {
    if (report.testResults.length !== expectedFiles) throw new Error('INCOMPLETE_API_REPORT');
    return;
  }
  const actual = report.testResults.map(file => {
    const marker = '/apps/api/', at = file.name?.lastIndexOf(marker) ?? -1;
    if (at < 0) throw new Error('INVALID_API_REPORT_PATH');
    return file.name.slice(at + marker.length);
  }).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expectedFiles.map(row => row.file).sort())) {
    throw new Error('INCOMPLETE_API_REPORT');
  }
}
function identity(env) {
  const result = { sha: env.GITHUB_SHA, run: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT };
  if (!/^[a-f0-9]{40}$/.test(result.sha ?? '') || !/^\d+$/.test(result.run ?? '') || !/^\d+$/.test(result.attempt ?? '')) throw new Error('INVALID_API_EVIDENCE_IDENTITY');
  return result;
}
export function record(directory, env = process.env) {
  const report = readFileSync(join(directory, 'report.json'));
  const log = readFileSync(join(directory, 'test.log'));
  validateReport(JSON.parse(report));
  if (!log.toString().trim()) throw new Error('EMPTY_API_LOG');
  writeFileSync(join(directory, 'identity.json'), JSON.stringify({ ...identity(env), report: hash(report), log: hash(log) }));
}
export function selectProducerArtifacts(artifacts, plan, env = process.env) {
  identity(env);
  return ['coverage', ...plan.shards.map(shard => `shard-${shard}`), 'exclusive'].map(part => {
    const prefix = `base-api-${part}-${env.GITHUB_RUN_ID}-`;
    const candidates = artifacts.filter(row => row.name?.startsWith(prefix))
      .map(row => ({...row, part, attempt:row.name.slice(prefix.length)}))
      .filter(row => /^[1-9]\d*$/.test(row.attempt) && Number(row.attempt) <= Number(env.GITHUB_RUN_ATTEMPT))
      .sort((a,b) => Number(b.attempt)-Number(a.attempt));
    if (!candidates.length || candidates[0].expired || candidates.filter(row => row.attempt === candidates[0].attempt).length !== 1) throw new Error('MISSING_OR_AMBIGUOUS_PRODUCER_ARTIFACT');
    return candidates[0];
  });
}
export function download(directory, env = process.env) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '')) throw new Error('INVALID_REPOSITORY');
  const plan = shardPlan(JSON.parse(readFileSync('.harness/api-test-shards.json', 'utf8')));
  identity(env);
  const pages = JSON.parse(execFileSync('gh', ['api', `repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/artifacts`, '--paginate', '--slurp'], {encoding:'utf8',timeout:120000}));
  const selected = selectProducerArtifacts(pages.flatMap(page => page.artifacts), plan, env);
  mkdirSync(directory,{recursive:true});
  for (const row of selected) execFileSync('gh', ['run','download',env.GITHUB_RUN_ID,'--repo',env.GITHUB_REPOSITORY,'--name',row.name,'--dir',directory], {stdio:'inherit',timeout:120000});
  writeFileSync(join(directory,'..','api-producers.json'),JSON.stringify(Object.fromEntries(selected.map(row => [row.part,row.attempt]))));
}
export function bundle(directory, plan, env = process.env, producerAttempts) {
  const expected = ['coverage', ...plan.shards.map(shard => `shard-${shard}`), 'exclusive'];
  if (readdirSync(directory).sort().join() !== [...expected].sort().join()) throw new Error('MISSING_OR_UNEXPECTED_API_EVIDENCE');
  const coverage = JSON.parse(readFileSync(join(directory, 'coverage', 'coverage.json'), 'utf8'));
  if (coverage.status !== 'discovery-coverage-verified' || coverage.shards !== plan.count || coverage.counts?.length !== plan.count || coverage.partitions?.length !== plan.count || !coverage.exclusive?.length || coverage.counts.some(count => !Number.isInteger(count) || count < 1) || coverage.counts.reduce((a,b)=>a+b,0) !== coverage.files) throw new Error('INVALID_API_COVERAGE');
  if (coverage.partitions.some((rows,index) => rows.length !== coverage.counts[index])) throw new Error('INVALID_API_PARTITION_COUNTS');
  const files = coverage.partitions.flat().map(row => JSON.stringify([row.projectName ?? '',row.file]));
  if (new Set(files).size !== coverage.files || hash([...files].sort().join('\n')) !== coverage.discoverySha256) throw new Error('INVALID_API_PARTITION_UNION');
  const expectedIdentity = identity(env);
  const producerIdentity = part => {
    const attempt = producerAttempts ? producerAttempts[part] : expectedIdentity.attempt;
    if (!/^[1-9]\d*$/.test(attempt ?? '') || Number(attempt) > Number(expectedIdentity.attempt)) throw new Error('INVALID_PRODUCER_ATTEMPT');
    return {...expectedIdentity,attempt};
  };
  const coverageIdentity = JSON.parse(readFileSync(join(directory, 'coverage', 'identity.json'), 'utf8'));
  if (Object.keys(expectedIdentity).some(key => coverageIdentity[key] !== producerIdentity('coverage')[key]) || coverageIdentity.coverage !== hash(readFileSync(join(directory, 'coverage', 'coverage.json')))) throw new Error('INVALID_COVERAGE_IDENTITY');
  const logs = [];
  for (const part of expected.filter(name => name !== 'coverage')) {
    const folder = join(directory, part), report = readFileSync(join(folder, 'report.json')), log = readFileSync(join(folder, 'test.log'));
    const metadata = JSON.parse(readFileSync(join(folder, 'identity.json'), 'utf8'));
    if (Object.keys(expectedIdentity).some(key => metadata[key] !== producerIdentity(part)[key]) || metadata.report !== hash(report) || metadata.log !== hash(log) || !log.toString().trim()) throw new Error('INVALID_API_EVIDENCE_IDENTITY_OR_HASH');
    validateReport(JSON.parse(report), part === 'exclusive' ? coverage.exclusive : coverage.partitions[Number(part.slice(6))-1]);
    logs.push(`\n=== API ${part} ===\n${log.toString()}`);
  }
  return logs.join('\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, directory] = process.argv.slice(2);
  if (command === 'prerequisites') assertPrerequisites(JSON.parse(process.env.CI_BASE_NEEDS ?? 'null'));
  else if (command === 'download') download(directory);
  else if (command === 'record') record(directory);
  else if (command === 'discover') {
    const plan = shardPlan(JSON.parse(readFileSync('.harness/api-test-shards.json', 'utf8')));
    const coverage = await discoverCoverage(plan);
    const scratch = mkdtempSync(join(tmpdir(), 'wsx-exclusive-discovery-'));
    try {
      const output = join(scratch, 'files.json');
      const child = spawnSync(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'list', '--filesOnly', '--config=vitest.exclusive.config.ts', `--json=${output}`], {cwd:resolve('apps/api'), encoding:'utf8', timeout:30000});
      if (child.error || child.status !== 0) throw new Error('EXCLUSIVE_DISCOVERY_FAILED');
      const rows = JSON.parse(readFileSync(output, 'utf8'));
      const exclusive = rows.map(row => ({file:row.file.slice(resolve('apps/api').length+1), projectName:row.projectName ?? ''}));
      if (!exclusive.length || exclusive.some(row => row.file.startsWith('..') || !row.file.endsWith('.test.ts'))) throw new Error('INVALID_EXCLUSIVE_DISCOVERY');
      mkdirSync(directory,{recursive:true});
      writeFileSync(join(directory,'coverage.json'),JSON.stringify({schemaVersion:1,status:'discovery-coverage-verified',...coverage,exclusive}));
    } finally {rmSync(scratch,{recursive:true,force:true});}
  } else if (command === 'coverage') {
    const data = readFileSync(join(directory, 'coverage.json'));
    mkdirSync(directory, {recursive:true});
    writeFileSync(join(directory, 'identity.json'), JSON.stringify({...identity(process.env), coverage:hash(data)}));
  } else if (command === 'bundle') {
    const plan = shardPlan(JSON.parse(readFileSync('.harness/api-test-shards.json', 'utf8')));
    writeFileSync(join(directory, '..', 'api-tests.log'), bundle(directory, plan, process.env, JSON.parse(readFileSync(join(directory,'..','api-producers.json'),'utf8'))));
  } else throw new Error('INVALID_BASE_API_COMMAND');
}
