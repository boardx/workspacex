/** CI-only full-coverage benchmark. Never production admission. */
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { openSync, closeSync, fstatSync, readFileSync, mkdirSync, writeFileSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = resolve(ROOT, 'phases/phase-01-run-a-project/evidence/ci/smoke-shards');
const PRIMARY = 'seeded-github-import';
export class ShardError extends Error {}
const need = (v, code) => { if (!v) throw new ShardError(code); };
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const sha = v => createHash('sha256').update(v).digest('hex');
const integer = v => Number.isSafeInteger(v) && v >= 0;
const stamp = v => { need(typeof v === 'string' && /(?:Z|[+]00:00)$/.test(v) && Number.isFinite(Date.parse(v)), 'UTC_TIME'); return Date.parse(v); };
export function shard(value) {
  need(typeof value === 'string' && /^[1-4]\/[24]$/.test(value), 'SHARD_SCOPE');
  const [current, total] = value.split('/').map(Number);
  need(current <= total, 'SHARD_SCOPE'); return { current, total };
}
export function context(env, part, total) {
  need(integer(part) && [2, 4].includes(total) && part <= total, 'PART_SCOPE');
  need(/^[a-f0-9]{40}$/.test(env.WSX_SMOKE_SOURCE_SHA ?? ''), 'SOURCE_SHA');
  need(/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '') && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? ''), 'RUN_ID');
  need(env.RUNNER_ENVIRONMENT === 'github-hosted', 'HOSTED_RUNNER_REQUIRED');
  return { source: env.WSX_SMOKE_SOURCE_SHA, run: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT,
    part, total, isolationSeed: 'ci-smoke-' + env.GITHUB_RUN_ID + '-' + env.GITHUB_RUN_ATTEMPT + '-' + part };
}
export function reduceReport(report, meta, log, host = hostname()) {
  need(obj(report) && obj(report.config) && obj(report.stats) && Array.isArray(report.suites), 'REPORT_SHAPE');
  need(Array.isArray(report.errors) && report.errors.length === 0, 'REPORT_ERRORS');
  const observedShard = report.config.shard;
  need(meta.part === 0 ? !observedShard : obj(observedShard) && observedShard.current === meta.part && observedShard.total === meta.total, 'OBSERVED_SHARD');
  const start = stamp(report.stats.startTime);
  need(typeof report.stats.duration === 'number' && Number.isFinite(report.stats.duration) && report.stats.duration >= 0, 'REPORT_DURATION');
  const records = [], ids = new Set();
  function walk(suites, depth, parents = []) {
    need(depth <= 64 && Array.isArray(suites), 'SUITE_DEPTH');
    for (const suite of suites) {
      need(obj(suite) && (suite.specs === undefined || Array.isArray(suite.specs)), 'SUITE_SHAPE');
      for (const spec of suite.specs ?? []) {
        need(obj(spec) && typeof spec.title === 'string' && typeof spec.file === 'string' &&
          !spec.file.startsWith('/') && !spec.file.includes('\\') && !spec.file.split('/').includes('..') &&
          /^[a-zA-Z0-9_./-]+$/.test(spec.file) && integer(spec.line) && integer(spec.column) && Array.isArray(spec.tests), 'SPEC_SHAPE');
        for (const test of spec.tests) {
          need(obj(test) && typeof test.projectName === 'string' && test.expectedStatus === 'passed' &&
            test.status === 'expected' && Array.isArray(test.results) && test.results.length === 1, 'TEST_NOT_FIRST_PASS');
          const result = test.results[0];
          need(obj(result) && result.status === 'passed' && result.retry === 0 && integer(result.duration), 'TEST_NOT_FIRST_PASS');
          const begin = stamp(result.startTime);
          const id = sha(JSON.stringify([test.projectName, spec.file, spec.line, spec.column, ...parents, suite.title ?? '', spec.title]));
          need(!ids.has(id), 'DUPLICATE_TEST_ID'); ids.add(id);
          records.push({ id, project: test.projectName, file: spec.file, durationMs: result.duration,
            startedAt: new Date(begin).toISOString(), finishedAt: new Date(begin + result.duration).toISOString() });
        }
      }
      walk(suite.suites ?? [], depth + 1, [...parents, suite.title ?? '']);
    }
  }
  walk(report.suites, 0);
  need(records.length > 0 && records.some(r => r.project === PRIMARY) && records.length <= 10000, 'EMPTY_COLLECTION');
  need(report.stats.expected === records.length && report.stats.unexpected === 0 && report.stats.skipped === 0 && report.stats.flaky === 0, 'REPORT_COUNTS');
  const matches = [...log.matchAll(/\[test-isolation\] id=([a-zA-Z0-9_-]+) db=([a-zA-Z0-9_-]+) compose=([a-zA-Z0-9_-]+)/g)];
  need(matches.length === 1 && matches[0][1] === meta.isolationSeed, 'ISOLATION_OBSERVATION');
  need(typeof host === 'string' && host.length > 0, 'HOST_FINGERPRINT');
  return { kind: 'ci-smoke-part-v1', ...meta, status: 'PASSED', primaryProject: PRIMARY,
    observedShard: observedShard ?? null, startedAt: report.stats.startTime,
    finishedAt: new Date(start + report.stats.duration).toISOString(), testReportDurationMs: report.stats.duration,
    database: matches[0][2], composeProject: matches[0][3], hostSha256: sha(host),
    records, productionAccepted: false, thirtyMinuteProductionProven: false,
    clockScope: 'runner test report; excludes pre-job queue and release phases' };
}
export function aggregate(parts, expected) {
  need(Array.isArray(parts) && parts.length === expected.total + 1, 'PART_COUNT');
  const byPart = new Map();
  for (const p of parts) {
    need(obj(p) && p.kind === 'ci-smoke-part-v1' && p.status === 'PASSED' &&
      p.source === expected.source && p.run === expected.run && p.attempt === expected.attempt &&
      p.total === expected.total && integer(p.part) && p.part <= p.total && Array.isArray(p.records), 'PART_IDENTITY');
    need(p.records.every(r => obj(r) && /^[a-f0-9]{64}$/.test(r.id ?? '') && typeof r.project === 'string' && typeof r.file === 'string' && integer(r.durationMs)), 'RECORD_SHAPE');
    need(!byPart.has(p.part), 'DUPLICATE_PART'); byPart.set(p.part, p);
    need(p.isolationSeed === 'ci-smoke-' + p.run + '-' + p.attempt + '-' + p.part, 'ISOLATION_SEED');
    need(p.productionAccepted === false && p.thirtyMinuteProductionProven === false, 'FALSE_RELEASE_CLAIM');
  }
  const baseline = byPart.get(0); need(baseline && baseline.records.length === 220, 'BASELINE_220_REQUIRED');
  const plan = new Map(baseline.records.map(r => [r.id, r])); need(plan.size === 220, 'BASELINE_DUPLICATE');
  const dependencies = new Set(baseline.records.filter(r => r.project !== PRIMARY).map(r => r.id));
  const primary = new Set(baseline.records.filter(r => r.project === PRIMARY).map(r => r.id));
  need(primary.size > 0, 'PRIMARY_EMPTY');
  const seen = new Set(), hosts = new Set(), dbs = new Set(), stacks = new Set();
  let executions = 0;
  for (let n = 0; n <= expected.total; n++) {
    const p = byPart.get(n); need(p, 'MISSING_PART');
    for (const [set, value] of [[hosts,p.hostSha256],[dbs,p.database],[stacks,p.composeProject]]) {
      need(typeof value === 'string' && value.length > 0 && !set.has(value), 'FIXTURE_CONFLICT'); set.add(value);
    }
    stamp(p.startedAt); stamp(p.finishedAt); need(stamp(p.finishedAt) >= stamp(p.startedAt), 'CLOCK_ORDER');
    if (n === 0) continue;
    need(obj(p.observedShard) && p.observedShard.current === n && p.observedShard.total === expected.total, 'PART_SHARD');
    const local = new Set();
    for (const r of p.records) {
      const original = plan.get(r.id);
      need(original && r.project === original.project && r.file === original.file && !local.has(r.id), 'UNPLANNED_OR_DUPLICATE_TEST');
      need(integer(r.durationMs), 'TEST_DURATION'); local.add(r.id); executions++;
      if (primary.has(r.id)) { need(!seen.has(r.id), 'DUPLICATE_PRIMARY'); seen.add(r.id); }
    }
    need([...dependencies].every(id => local.has(id)) && [...local].some(id => primary.has(id)), 'DEPENDENCY_OR_PRIMARY_MISSING');
  }
  need(primary.size === seen.size && [...primary].every(id => seen.has(id)), 'COVERAGE_MISSING');
  return { kind: 'ci-smoke-coverage-v1', source: expected.source, run: expected.run, attempt: expected.attempt,
    baselineUnique: 220, shardedUnique: dependencies.size + seen.size, shardExecutions: executions,
    repeatedDependencyExecutions: executions - 220, coverageSetEqual: true,
    fixtureNamespacesDistinct: true, hostFingerprintsDistinct: true,
    files: [...new Set(baseline.records.map(r => r.file))].sort().map(file => ({
      file, baselineCaseMs: baseline.records.filter(r => r.file === file).reduce((sum,r) => sum + r.durationMs,0) })),
    productionAccepted: false, thirtyMinuteProductionProven: false,
    note: 'Case-duration sums are not release wall time; intentional dependency re-execution is explicit.' };
}
function bounded(path, limit = 64 * 1024 * 1024) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const a=fstatSync(fd); need(a.isFile() && a.nlink===1 && a.size<=limit,'INPUT_BOUND');
    const raw=readFileSync(fd); const b=fstatSync(fd);
    need(raw.length===a.size && a.mtimeMs===b.mtimeMs && a.ctimeMs===b.ctimeMs,'INPUT_CHANGED'); return raw;
  } finally { closeSync(fd); }
}
function save(name, value) { mkdirSync(OUT,{recursive:true}); writeFileSync(resolve(OUT,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600}); }
function main() {
  const mode=process.argv[2];
  if (mode==='execute') {
    need(!process.env.WORKSPACEX_REUSE_INFRA && !process.env.WORKSPACEX_KEEP_TEST_STACK,'SHARED_FIXTURE_FORBIDDEN');
    need(process.env.WSX_SMOKE_BENCHMARK==='1','BENCHMARK_REQUIRED');
    const p=shard(process.env.WSX_SMOKE_SHARD);
    const meta=context(process.env,p.current,p.total);
    need(process.env.WORKSPACEX_ISOLATION_SEED===meta.isolationSeed,'ISOLATION_SEED');
    const result=spawnSync('pnpm',['--filter','web','exec','playwright','test','--config','playwright.fullstack-smoke.config.ts',
      '--project='+PRIMARY,'--shard='+p.current+'/'+p.total],{stdio:'inherit'});
    return result.error ? 1 : result.status ?? 1;
  }
  const part=Number(process.argv[3]),total=Number(process.argv[4]);
  const meta=context(process.env,part,total);
  try {
    if (mode==='report') {
      const raw=bounded(resolve(ROOT,'apps/web/test-results/fullstack-smoke.json'));
      const value=reduceReport(JSON.parse(raw.toString('utf8')),meta,bounded(resolve(ROOT,'smoke-benchmark.log')).toString('utf8'));
      value.originalReportSha256=sha(raw); save('part-'+part+'.json',value); return 0;
    }
    need(mode==='aggregate' && part===0,'MODE');
    need(process.env.BENCHMARK_JOB_RESULT==='success' && process.env.UNIT_JOB_RESULT==='success','UPSTREAM_JOB_FAILED');
    const parts=Array.from({length:total+1},(_,i)=>JSON.parse(bounded(resolve(OUT,'parts/part-'+i+'.json'),2*1024*1024)));
    save('aggregate.json',aggregate(parts,meta)); return 0;
  } catch (error) {
    if (!(error instanceof ShardError || error instanceof SyntaxError || error instanceof RangeError || ['ENOENT','ELOOP','EACCES'].includes(error.code))) throw error;
    save(mode==='aggregate'?'aggregate.json':'part-'+part+'.json',{kind:'ci-smoke-part-v1',...meta,status:'REJECTED',reason:'SMOKE_BENCHMARK_REJECTED',productionAccepted:false,thirtyMinuteProductionProven:false});
    return 1;
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode=main(); } catch(error) {
    if(!(error instanceof ShardError)) throw error;
    console.error('SMOKE_BENCHMARK_REJECTED'); process.exitCode=1;
  }
}
