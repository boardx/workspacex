#!/usr/bin/env node
/** QA-only single-phase driver. Does not start a stack, retry, alter config or expose credentials. */
import { existsSync, mkdirSync, readFileSync, createWriteStream, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const phase = option('--phase'), fixtureFile = option('--runtime'), output = option('--out');
if (!['setup', 's1', 's2', 's3', 's4', 's5', 's6', 'sum'].includes(phase) || !fixtureFile || !isAbsolute(fixtureFile) || !output || !isAbsolute(output)) throw new Error('Use --phase setup|s1|s2|s3|s4|s5|s6|sum --runtime ABS_PRIVATE_JSON --out NEW_ABS_DIRECTORY --allow-phase EXACT_PHASE');
if (option('--allow-phase') !== phase) throw new Error('EXACT_ROOT_PHASE_GO_REQUIRED');
if (existsSync(output)) throw new Error('NEW_OUTPUT_DIRECTORY_REQUIRED_PRESERVE_OLD_RESULTS');
const runtime = JSON.parse(readFileSync(fixtureFile, 'utf8'));
if (runtime.apiPathPrefix !== '/__fullstack_api' || !runtime.nativeJournal || !runtime.journeyState || !runtime.isolation?.WORKSPACEX_ISOLATION_ID) throw new Error('ACTUAL_OWNER_RUNTIME_PATHS_AND_PREFIX_REQUIRED');
const ownerPhase = phase === 'sum' ? 'summary' : phase;
if (phase !== 'setup' && runtime.paidWindowPhase !== ownerPhase) throw new Error('ACTUAL_OWNER_EXACT_PAID_WINDOW_REQUIRED');
if (args.includes('--check')) { console.log(JSON.stringify({ phase, ownerPhase, configurationOnly: true, packVerificationNotPerformed: true, modelRequests: 0, spawned: false })); process.exit(0); }
const namespace = dirname(runtime.nativeJournal), setupFile = runtime.setupPins ?? resolve(namespace, 'setup-import-pins.json');
const methodsVersion = runtime.methodsPackVersion;
if (!['1.3.1', '1.3.2'].includes(methodsVersion)) throw new Error('ACTUAL_APPROVED_METHODS_VERSION_REQUIRED');
if (phase !== 'setup' && !existsSync(setupFile)) throw new Error('FREE_PACK_SETUP_AND_OWNER_VERIFICATION_REQUIRED_BEFORE_SEND');
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('AIDT_V2_')) delete env[key];
Object.assign(env, Object.fromEntries(Object.entries(runtime.isolation).map(([key, value]) => [key, String(value)])), {
  PATH: `/tmp/aidt-node/node_modules/node/bin:/tmp/aidt-tools/node_modules/.bin:${env.PATH}`,
  PNPM_HOME: '/tmp/aidt-pnpm', XDG_DATA_HOME: '/tmp/aidt-xdg-data', XDG_CACHE_HOME: '/tmp/aidt-xdg-cache', npm_config_store_dir: '/tmp/aidt-pnpm/store',
  PLAYWRIGHT_BROWSERS_PATH: '/tmp/aidt-playwright', NEXT_PUBLIC_API_PATH_PREFIX: runtime.apiPathPrefix,
  REAL_MODEL_E2E_BASE_URL: runtime.baseURL, REAL_MODEL_E2E_EMAIL: runtime.fundedAdminEmail, REAL_MODEL_E2E_PASSWORD: runtime.fundedAdminPassword,
  REAL_MODEL_E2E_RUN_TIMEOUT_MS: '360000', AIDT_V2_API_ORIGIN: runtime.apiOrigin, AIDT_V2_REAL_AGENT: '1', AIDT_V2_ACCOUNT_ROLE: 'funded-admin-technical',
  AIDT_V2_REMEDIATION: 'native-seven-no-bridge-20261117', AIDT_V2_AUTHORIZED_PHASE: phase, AIDT_V2_RUN_LEDGER: runtime.nativeJournal,
  AIDT_V2_METHODS_VERSION: methodsVersion, ...(runtime.previousSetupPins ? { AIDT_V2_PREVIOUS_SETUP_RESULT: runtime.previousSetupPins } : {}),
  AIDT_V2_SUMMARY_SEMANTIC_REVIEW_FILE: resolve(namespace, 'summary-semantic-review.json'),
  AIDT_V2_COMPLETION_STATE: runtime.journeyState, AIDT_V2_SETUP_RESULT: setupFile, AIDT_V2_PLAN_REVIEW_DIR: resolve(namespace, 'proof-review'), AIDT_V2_OUTPUT_DIR: output,
});
const spec = phase === 'setup' ? 'aidt-v2-remediation-setup.spec.ts' : 'aidt-v2-completion.spec.ts';
if (phase === 'setup') env.AIDT_V2_FREE_SETUP = `approved-methods-${methodsVersion}-summary-1.0.1`;
else env.AIDT_V2_FRESH_JOURNEY = 'fresh-native-seven-20261117';
const command = ['--filter', 'web', 'exec', 'playwright', 'test', '--config', 'playwright.aidt-v2.config.ts', spec];
if (phase !== 'setup') command.push('--grep', `completion ${phase.toUpperCase()}:`);
mkdirSync(output, { recursive: false, mode: 0o700 });
// Paid execution cannot reach test hooks until its exact final command discovers one target.
const cwd = resolve(import.meta.dirname, '../../../..');
const discovery = spawnSync('pnpm', [...command, '--list'], { cwd, env, encoding: 'utf8', maxBuffer: 1024 * 1024 });
const discovered = `${discovery.stdout ?? ''}${discovery.stderr ?? ''}`;
writeFileSync(resolve(output, 'preflight-list.txt'), discovered, { flag: 'wx', mode: 0o600 });
process.stdout.write(discovered);
if (discovery.status !== 0 || !/Total:\s*1 test(?:s)? in 1 file/u.test(discovered)) throw new Error('EXACTLY_ONE_PHASE_TEST_MUST_BE_DISCOVERED_BEFORE_EXECUTION');
if (args.includes('--list')) process.exit(0);
const log = createWriteStream(resolve(output, 'console.txt'), { flags: 'wx', mode: 0o600 });
const child = spawn('pnpm', command, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log.write(chunk); process.stdout.write(chunk); });
child.on('error', error => { log.end(`${error.message}\n`); process.exitCode = 1; });
child.on('close', code => { log.end(); process.exitCode = code ?? 1; });
