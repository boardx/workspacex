import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../../', import.meta.url));
export function shardPlan(input) {
  if (input?.schemaVersion !== 1 || !Number.isInteger(input.count) || input.count < 1 || input.count > 32 || Object.keys(input).sort().join(',') !== 'count,schemaVersion') throw new Error('INVALID_SHARD_POLICY');
  return { count: input.count, shards: Array.from({length: input.count}, (_, i) => i + 1) };
}
export function assertCoverage(full, partitions) {
  const identity = row => typeof row === 'string' ? row : JSON.stringify([row.projectName ?? '', row.file]);
  const fullKeys = full.map(identity);
  if (!full.length || new Set(fullKeys).size !== full.length || !partitions.length) throw new Error('INVALID_FULL_DISCOVERY');
  const expected = new Set(fullKeys), seen = new Set();
  for (const files of partitions) {
    if (!files.length) throw new Error('EMPTY_SHARD');
    for (const row of files) {
      const file = identity(row);
      if (!expected.has(file)) throw new Error('UNEXPECTED_SHARD_FILE');
      if (seen.has(file)) throw new Error('DUPLICATE_SHARD_FILE');
      seen.add(file);
    }
  }
  if (seen.size !== expected.size) throw new Error('MISSING_SHARD_FILE');
  return { files: full.length, shards: partitions.length, counts: partitions.map(files => files.length),
    discoverySha256: createHash('sha256').update([...fullKeys].sort().join('\n')).digest('hex') };
}
export async function discoverCoverage(plan, apiRoot = resolve(root, 'apps/web'), configFile = resolve(apiRoot, 'vitest.config.ts')) {
  const cwd = apiRoot, directory = mkdtempSync(resolve(tmpdir(), 'wsx-api-discovery-'));
  const discover = (shard) => {
    const output = resolve(directory, shard ? `shard-${shard}.json` : 'full.json');
    const args = [resolve(root, 'node_modules/vitest/vitest.mjs'), 'list', '--filesOnly', `--json=${output}`];
    if (shard) args.push(`--shard=${shard}/${plan.count}`);
    const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 30000 });
    if (result.error || result.status !== 0) throw new Error('VITEST_DISCOVERY_FAILED');
    const rows = JSON.parse(readFileSync(output, 'utf8'));
    if (!Array.isArray(rows)) throw new Error('INVALID_DISCOVERY_OUTPUT');
    return rows.map(row => { const file = relative(cwd, row.file); const projectName = row.projectName ?? ''; if (file.startsWith('..') || ! /\.test\.tsx?$/.test(file) || typeof projectName !== 'string') throw new Error('INVALID_DISCOVERY_FILE'); return { file, projectName }; });
  };
  try {
    // Vitest 2 list --filesOnly bypasses sharding. Use its public, installed
    // sequencer on actual full discovery, rather than copying a hash algorithm.
    const full = discover();
    const { BaseSequencer } = await import('vitest/node');
    const specs = full.map(row => ({ moduleId: resolve(cwd, row.file), project: { name: row.projectName }, discovery: row }));
    const partitions = [];
    for (const index of plan.shards) {
      const sequencer = new BaseSequencer({config:{root:cwd,shard:{index,count:plan.count}}});
      partitions.push((await sequencer.shard(specs)).map(spec => spec.discovery));
    }
    return { ...assertCoverage(full, partitions), partitions };
  }
  finally { rmSync(directory, { recursive: true, force: true }); }
}
const hash = value => createHash('sha256').update(value).digest('hex');
const key = row => JSON.stringify([row.projectName ?? '', row.file]);
export function validateReport(report, expected, cwd) {
  if(expected.some(row=>row.projectName !== '')) throw new Error('UNSUPPORTED_PROJECT_REPORT_IDENTITY');
  if (!report.success || report.numFailedTests || report.numFailedTestSuites || !Array.isArray(report.testResults)) throw new Error('FAILED_REPORT');
  const passed = report.testResults.flatMap(row=>row.assertionResults??[]).filter(test=>test.status==='passed').length;
  if(passed<1 || report.numPassedTests!==passed) throw new Error('ZERO_OR_INCONSISTENT_EXECUTION');
  const actual = report.testResults.map(row => ({file: relative(cwd,row.name),projectName:row.projectName ?? ''}));
  if (actual.length !== expected.length || actual.some(row => !expected.some(item=>key(item)===key(row))) || new Set(actual.map(key)).size !== actual.length) throw new Error('REPORT_IDENTITY_MISMATCH');
  if (report.testResults.some(row=>row.status !== 'passed' || !row.assertionResults?.length || row.assertionResults.some(test=>!['passed','pending','todo'].includes(test.status)))) throw new Error('EMPTY_OR_FAILED_REPORT');
}
export function validateShardEvidence(coverage, outputs, identity) {
  if(['sourceSHA','run','attempt'].some(field=>typeof identity?.[field]!=='string' || !identity[field].trim())) throw new Error('MISSING_RUN_IDENTITY');
  const checked = assertCoverage(coverage.partitions.flat(), coverage.partitions);
  if(checked.discoverySha256!==coverage.discoverySha256 || checked.shards!==coverage.shards || JSON.stringify(checked.counts)!==JSON.stringify(coverage.counts)) throw new Error('INVALID_COVERAGE_HASH');
  if(outputs.length !== coverage.shards) throw new Error('MISSING_SHARD_REPORT');
  const seen=new Set();
  for(const output of outputs) {
    const {manifest,report,log}=output;
    const index=manifest.index;
    if (!Number.isInteger(index)||index<1||index>coverage.shards||seen.has(index)) throw new Error('INVALID_SHARD_INDEX');
    seen.add(index);
    for(const field of ['sourceSHA','run','attempt']) if(String(manifest[field])!==String(identity[field])) throw new Error('SOURCE_IDENTITY_MISMATCH');
    if(manifest.count!==coverage.shards||manifest.discoverySha256!==coverage.discoverySha256||manifest.reportSha256!==hash(report)||manifest.logSha256!==hash(log)||JSON.stringify(manifest.identities)!==JSON.stringify(coverage.partitions[index-1])) throw new Error('SHARD_EVIDENCE_MISMATCH');
    validateReport(JSON.parse(report),manifest.identities,manifest.cwd);
  }
  return true;
}
export async function runShard(plan,index,directory,cwd=resolve(root,'apps/web')) {
  if(!plan.shards.includes(index)) throw new Error('INVALID_SHARD_INDEX');
  const coverage=await discoverCoverage(plan,cwd);
  if(coverage.partitions.flat().some(row=>row.projectName!=='')) throw new Error('UNSUPPORTED_PROJECT_REPORT_IDENTITY');
  const reportPath=resolve(directory,'report.json');
  const result=spawnSync(process.execPath,[resolve(root,'node_modules/vitest/vitest.mjs'),'run','--bail=1',`--shard=${index}/${plan.count}`,'--reporter=json',`--outputFile=${reportPath}`],{cwd,encoding:'utf8',maxBuffer:64*1024*1024});
  const log=(result.stdout??'')+(result.stderr??'');writeFileSync(resolve(directory,'run.log'),log);
  if(result.error||result.status!==0) throw new Error('SHARD_RUN_FAILED');
  const report=readFileSync(reportPath,'utf8');validateReport(JSON.parse(report),coverage.partitions[index-1],cwd);
  const sourceSHA=process.env.GITHUB_SHA??spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim();
  const manifest={schemaVersion:1,index,count:plan.count,sourceSHA,run:process.env.GITHUB_RUN_ID??'local',attempt:process.env.GITHUB_RUN_ATTEMPT??'1',cwd,discoverySha256:coverage.discoverySha256,identities:coverage.partitions[index-1],reportSha256:hash(report),logSha256:hash(log)};
  writeFileSync(resolve(directory,'manifest.json'),JSON.stringify(manifest,null,2));
  return coverage;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const plan=shardPlan(JSON.parse(readFileSync(resolve(root,'.harness/web-test-shards.json'),'utf8')));
 const command=process.argv[2];
 if(command==='--plan') {
  const output=`count=${plan.count}\nshards=${JSON.stringify(plan.shards)}\n`;
  if(process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT,output,{flag:'a'}); else process.stdout.write(output);
 } else if(command==='--verify') {
  const coverage={schemaVersion:1,status:'discovery-coverage-verified',...await discoverCoverage(plan)};
  writeFileSync(resolve(process.argv[3]??'web-shard-coverage.json'),JSON.stringify(coverage,null,2));
  console.log(JSON.stringify(coverage));
 } else if(command==='--run') {
  const index=Number(process.argv[3]), directory=resolve(process.argv[4]??'.');
  await runShard(plan,index,directory);
 } else throw new Error('INVALID_SHARD_COMMAND');
}
