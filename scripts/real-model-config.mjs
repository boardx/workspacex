// Read configuration as data. Never execute a deployment environment file.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const modelKeys = Object.freeze([
  'DASHSCOPE_API_KEY', 'DASHSCOPE_BASE_URL', 'DASHSCOPE_MODEL',
  'KERNEL_MODEL_PROVIDER', 'KERNEL_MODEL_API_KEY', 'KERNEL_MODEL_BASE_URL',
  'KERNEL_DEFAULT_AGENT_MODEL_ID',
]);
const allowed = new Set(modelKeys);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Single-line dotenv literals only. Errors contain locations, never source text.
export function parseModelEnv(contents) {
  const values = {};
  const errors = [];
  for (const [index, line] of contents.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    // Unrelated CN deployment fields or commands are never executed or imported.
    if (!match || !allowed.has(match[1])) continue;
    const key = match[1];
    let value = match[2].trim();
    let valid = true;
    if (value.startsWith("'") || value.startsWith('"')) {
      const quote = value[0];
      const close = value.indexOf(quote, 1);
      if (close < 0 || !/^\s*(?:#.*)?$/.test(value.slice(close + 1))) valid = false;
      else value = value.slice(1, close);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
      if (/[\s;'"<>|&]/.test(value)) valid = false;
    }
    // Do not send a literal ${SECRET} or shell expansion to a provider.
    if (/[`$\\\u0000-\u001f\u007f]/.test(value)) valid = false;
    if (!valid) errors.push({ code: 'unsupported_model_assignment', line: index + 1, field: key });
    else values[key] = value;
  }
  return { values, errors };
}

export function inspectModelConfig({ env = process.env, envFile, root = repoRoot } = {}) {
  const explicitFile = envFile ?? env.WORKSPACEX_ENV_FILE;
  const path = resolve(root, explicitFile || '.env.local');
  const values = Object.fromEntries(modelKeys.filter(key => env[key] !== undefined).map(key => [key, env[key]]));
  const errors = [];
  let fileStatus = 'readable';
  try {
    const parsed = parseModelEnv(readFileSync(path, 'utf8'));
    Object.assign(values, parsed.values);
    errors.push(...parsed.errors);
  } catch (error) {
    fileStatus = error.code === 'ENOENT' ? 'missing' : 'unreadable';
    // Explicit file selection never silently falls back to inherited keys.
    if (explicitFile || fileStatus === 'unreadable') errors.push({ code: `env_file_${fileStatus}` });
  }

  // Match real_model_alias_deployment_credentials: explicit DASHSCOPE wins.
  if (values.KERNEL_MODEL_PROVIDER === 'dashscope') {
    for (const [target, source] of [
      ['DASHSCOPE_API_KEY', 'KERNEL_MODEL_API_KEY'],
      ['DASHSCOPE_BASE_URL', 'KERNEL_MODEL_BASE_URL'],
      ['DASHSCOPE_MODEL', 'KERNEL_DEFAULT_AGENT_MODEL_ID'],
    ]) if (!values[target] && values[source]) values[target] = values[source];
  }
  const required = ['DASHSCOPE_API_KEY', 'DASHSCOPE_BASE_URL', 'DASHSCOPE_MODEL'];
  const missing = required.filter(key => !values[key]?.trim());
  const provider = values.KERNEL_MODEL_PROVIDER || (missing.length === 0 ? 'dashscope' : 'unresolved');
  if (!['dashscope', 'unresolved'].includes(provider)) errors.push({ code: 'unsupported_smoke_provider', field: 'KERNEL_MODEL_PROVIDER' });
  if (values.DASHSCOPE_BASE_URL) {
    try {
      const url = new URL(values.DASHSCOPE_BASE_URL);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
        || url.hostname.endsWith('.invalid') || url.hostname === '[::1]'
        || /^127\./.test(url.hostname)) throw new Error('invalid');
    } catch { errors.push({ code: 'invalid_real_model_endpoint', field: 'DASHSCOPE_BASE_URL' }); }
  }
  for (const key of ['DASHSCOPE_API_KEY', 'DASHSCOPE_MODEL']) {
    if (values[key] && (/[\s`$\u0000-\u001f\u007f]/.test(values[key])
      || /^(?:change[-_]?me|your[-_].*|placeholder|fake|test|dummy|probe-not-a-secret)$/i.test(values[key])
      || /^<.*>$/.test(values[key]))) errors.push({ code: 'invalid_model_value', field: key });
  }
  const ready = missing.length === 0 && errors.length === 0;
  return {
    // Only report may be logged. Arbitrary strings and values stay private.
    report: {
      configuration: ready ? 'ready' : 'blocked',
      source: { requested: explicitFile ? 'explicit_file' : 'default_file_or_exported_environment', fileStatus },
      provider: ['dashscope', 'unresolved'].includes(provider) ? provider : 'unsupported',
      fields: Object.fromEntries(required.map(key => [key, missing.includes(key) ? 'missing' : 'present'])),
      errors,
      connectivity: 'not_checked',
      modelAcceptance: 'not_run',
      localProfileChanged: false,
    },
    values,
  };
}

function main(args) {
  let envFile;
  let smoke = false;
  let stack = false;
  let uvicorn;
  let workDir;
  let sandboxModules;
  let prebuild = false;
  let lane;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--' && i === 0) continue;
    if (args[i] === '--model-env-file' && args[i + 1] && !args[i + 1].startsWith('--')) envFile = args[++i];
    else if (args[i] === '--smoke') smoke = true;
    else if (args[i] === '--stack') stack = true;
    else if (args[i] === '--prebuild') prebuild = true;
    else if (args[i] === '--uvicorn' && args[i + 1] && !args[i + 1].startsWith('--')) uvicorn = resolve(args[++i]);
    else if (args[i] === '--work-dir' && args[i + 1] && !args[i + 1].startsWith('--')) workDir = resolve(args[++i]);
    else if (args[i] === '--sandbox-modules' && args[i + 1] && !args[i + 1].startsWith('--')) sandboxModules = resolve(args[++i]);
    else if (args[i] === '--lane' && ['office', 'web-artifact-reliability'].includes(args[i + 1])) lane = args[++i];
    else {
      console.error('Usage: real-model-config.mjs [--model-env-file path] [--smoke | --stack --work-dir path --uvicorn path] [--lane office|web-artifact-reliability]');
      return 2;
    }
  }
  const { report, values } = inspectModelConfig({ envFile });
  if (prebuild && !stack) {
    console.error('--prebuild requires the explicit --stack mode.');
    return 2;
  }
  if ((smoke || stack) && report.source.fileStatus !== 'readable') {
    report.configuration = 'blocked';
    report.errors.push({ code: 'readable_file_required_for_safe_smoke' });
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.configuration !== 'ready') return 2;
  if (stack && (smoke || !workDir || !uvicorn)) {
    console.error('Explicit stack requires --work-dir and --uvicorn and cannot combine --smoke.');
    return 2;
  }
  if (!smoke && !stack) return 0;
  // Reuse the isolated smoke's existing stack/seed/lifecycle. The CN file is
  // never sourced downstream; only allowlisted model fields enter the child.
  const child = spawnSync('pnpm', [
    'exec', 'tsx', '.harness/scripts/with-test-isolation.ts', '--',
    ...(stack ? ['tsx', 'scripts/real-model-aidt-stack.mjs'] : ['bash', 'scripts/real-model-smoke.sh', ...(lane ? [lane] : [])]),
  ], { cwd: repoRoot, env: { ...process.env, ...values, WORKSPACEX_MODEL_ENV_ONLY: '1', ...(stack ? {
    WORKSPACEX_REAL_MODEL_DEV_OPT_IN: '1', REAL_MODEL_E2E_WORK_DIR: workDir, REAL_MODEL_E2E_UVICORN: uvicorn,
    REAL_MODEL_E2E_WEB_MODE: prebuild ? 'build-start' : 'dev',
    ...(sandboxModules ? { REAL_MODEL_E2E_SANDBOX_MODULES_DIR: sandboxModules } : {}),
  } : {}) }, stdio: 'inherit' });
  if (child.error) console.error('[real-model-config] smoke process could not start (details withheld).');
  return child.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
