import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { inspectModelConfig, modelKeys, parseModelEnv } from '../real-model-config.mjs';

const root = resolve(import.meta.dirname, '../..');
// Configuration fixtures only. No test contacts or imitates a model provider.
const complete = {
  DASHSCOPE_API_KEY: 'fixture-sensitive-key',
  DASHSCOPE_BASE_URL: 'https://provider.example/compatible-mode/v1',
  DASHSCOPE_MODEL: 'fixture-qwen',
};

function withFile(contents, run) {
  const dir = mkdtempSync(join(tmpdir(), 'wx-model-config-'));
  const path = join(dir, 'cn.local.env');
  try {
    writeFileSync(path, contents);
    return run({ dir, path });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function cleanEnv() {
  const env = { ...process.env };
  for (const key of [...modelKeys, 'WORKSPACEX_ENV_FILE', 'WORKSPACEX_MODEL_ENV_ONLY']) delete env[key];
  return env;
}

test('CN deployment file is read as data; only model fields are selected', () => {
  withFile([
    'export KERNEL_MODEL_PROVIDER=dashscope',
    "KERNEL_MODEL_API_KEY='fixture-sensitive-key' # literal",
    'KERNEL_MODEL_BASE_URL="https://provider.example/compatible-mode/v1"',
    'KERNEL_DEFAULT_AGENT_MODEL_ID=fixture-qwen',
    'DATABASE_URL=postgres://production.example/db',
    'WORKSPACEX_API_PORT=443',
    'KERNEL_DEEP_AGENT_BASE_URL=https://production.example',
    'LOCAL_RUNTIME_ALLOW_EGRESS=1',
  ].join('\r\n'), ({ path }) => {
    const { report, values } = inspectModelConfig({ env: {}, envFile: path });
    assert.equal(report.configuration, 'ready');
    assert.equal(report.connectivity, 'not_checked');
    assert.equal(report.modelAcceptance, 'not_run');
    assert.equal(report.localProfileChanged, false);
    assert.equal(values.DASHSCOPE_API_KEY, complete.DASHSCOPE_API_KEY);
    for (const key of ['DATABASE_URL', 'WORKSPACEX_API_PORT', 'LOCAL_RUNTIME_ALLOW_EGRESS', 'KERNEL_DEEP_AGENT_BASE_URL']) {
      assert.equal(values[key], undefined);
    }
    assert.ok(!JSON.stringify(report).includes(complete.DASHSCOPE_API_KEY));
    assert.ok(!JSON.stringify(report).includes('production.example'));
  });
});

test('missing explicit file is blocked even with complete inherited credentials', () => {
  const { report } = inspectModelConfig({ env: complete, envFile: '/nonexistent-model-config-20261116/cn.local.env' });
  assert.equal(report.configuration, 'blocked');
  assert.equal(report.source.fileStatus, 'missing');
  assert.deepEqual(report.errors, [{ code: 'env_file_missing' }]);
});

test('default missing file may use exported model variables, without claiming connectivity', () => {
  const { report } = inspectModelConfig({ env: complete, root: '/nonexistent-model-config-20261116' });
  assert.equal(report.configuration, 'ready');
  assert.equal(report.source.fileStatus, 'missing');
  assert.equal(report.connectivity, 'not_checked');
});

test('safe smoke requires an actually readable file before starting any real stack', () => {
  withFile('', ({ dir }) => {
    // Explicitly missing file also covers machines with complete inherited keys.
    const run = spawnSync(process.execPath, ['scripts/real-model-config.mjs', '--smoke', '--model-env-file', join(dir, 'missing.env')], {
      cwd: root, env: { ...cleanEnv(), ...complete }, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(run.status, 2);
    assert.ok(JSON.parse(run.stdout).errors.some(error => error.code === 'readable_file_required_for_safe_smoke'));
    assert.equal(run.stderr, '');
  });
});

test('explicit DashScope names retain precedence over deployment aliases', () => {
  withFile('KERNEL_MODEL_PROVIDER=dashscope\nKERNEL_MODEL_API_KEY=alternate-fixture\n', ({ path }) => {
    const { values } = inspectModelConfig({ env: complete, envFile: path });
    assert.equal(values.DASHSCOPE_API_KEY, complete.DASHSCOPE_API_KEY);
  });
});

test('OpenAI-only deployment configuration is not advertised as supported DashScope smoke', () => {
  withFile('KERNEL_MODEL_PROVIDER=openai-compatible\nKERNEL_MODEL_API_KEY=sensitive-other-key\n', ({ path }) => {
    const { report, values } = inspectModelConfig({ env: {}, envFile: path });
    assert.equal(report.configuration, 'blocked');
    assert.equal(report.provider, 'unsupported');
    assert.equal(values.DASHSCOPE_API_KEY, undefined);
    assert.ok(report.errors.some(error => error.code === 'unsupported_smoke_provider'));
    assert.equal(report.fields.DASHSCOPE_MODEL, 'missing');
  });
});

test('shell expansions fail with redacted locations; unrelated shell lines never execute', () => {
  withFile('', ({ path, dir }) => {
    const marker = join(dir, 'must-not-exist');
    writeFileSync(path, [
      `touch '${marker}'`,
      `DATABASE_URL=$(touch '${marker}')`,
      `DASHSCOPE_API_KEY=$(touch '${marker}')`,
      'DASHSCOPE_BASE_URL=https://provider.example/v1',
      'DASHSCOPE_MODEL=${SECRET_MODEL}',
    ].join('\n'));
    const run = spawnSync(process.execPath, ['scripts/real-model-config.mjs', '--model-env-file', path, '--smoke'], {
      cwd: root, env: cleanEnv(), encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(run.status, 2);
    assert.equal(existsSync(marker), false);
    assert.ok(!run.stdout.includes(marker));
    assert.ok(!run.stdout.includes('SECRET_MODEL'));
    assert.ok(!run.stderr.includes(marker));
    const report = JSON.parse(run.stdout);
    assert.equal(report.connectivity, 'not_checked');
    assert.equal(report.errors.filter(error => error.code === 'unsupported_model_assignment').length, 2);
  });
});

test('nonempty placeholder, whitespace and unsafe endpoints fail structural preflight', () => {
  const cases = [
    { DASHSCOPE_API_KEY: 'placeholder' },
    { DASHSCOPE_MODEL: 'has whitespace' },
    ...['http://provider.example/v1', 'https://user:secret@provider.example/v1',
      'https://provider.example/v1?key=secret', 'https://provider.example/v1#secret',
      'https://127.0.0.1/v1', 'https://localhost/v1', 'https://provider.invalid/v1',
      'not-a-url'].map(DASHSCOPE_BASE_URL => ({ DASHSCOPE_BASE_URL })),
  ];
  for (const overrides of cases) {
    const { report } = inspectModelConfig({ env: { ...complete, ...overrides }, root: '/nonexistent-model-config-20261116' });
    assert.equal(report.configuration, 'blocked');
    assert.equal(report.connectivity, 'not_checked');
    assert.ok(report.errors.length > 0);
  }
});

test('doctor CLI reports field status and never emits key, endpoint, model or arbitrary provider', () => {
  for (const provider of ['dashscope', 'sensitive-provider-string']) {
    withFile(Object.entries({ ...complete, KERNEL_MODEL_PROVIDER: provider }).map(([key, value]) => `${key}=${value}`).join('\n'), ({ path }) => {
      const run = spawnSync(process.execPath, ['scripts/real-model-config.mjs', '--model-env-file', path], {
        cwd: root, env: cleanEnv(), encoding: 'utf8', timeout: 10_000,
      });
      assert.equal(run.status, provider === 'dashscope' ? 0 : 2);
      for (const value of [...Object.values(complete), 'sensitive-provider-string']) assert.ok(!(run.stdout + run.stderr).includes(value));
      assert.equal(JSON.parse(run.stdout).modelAcceptance, 'not_run');
    });
  }
});

test('safe-loaded marker prevents existing shell loader from sourcing CN file again', () => {
  withFile('', ({ path, dir }) => {
    const marker = join(dir, 'must-not-exist');
    writeFileSync(path, `touch '${marker}'\nWORKSPACEX_API_PORT=443\n`);
    const run = spawnSync('bash', ['-c',
      'set -euo pipefail; source scripts/real-model-env.sh; real_model_load_env_file "$PWD"; test "$WORKSPACEX_API_PORT" = 32001',
    ], { cwd: root, env: { ...cleanEnv(), WORKSPACEX_ENV_FILE: path, WORKSPACEX_MODEL_ENV_ONLY: '1', WORKSPACEX_API_PORT: '32001' }, encoding: 'utf8' });
    assert.equal(run.status, 0);
    assert.equal(existsSync(marker), false);
  });
});

test('explicit safe smoke reuses isolated lane with model-only file values and preserves failure', () => {
  withFile([
    ...Object.entries(complete).map(([key, value]) => `${key}=${value}`),
    'DATABASE_URL=postgres://production.example/db',
    'WORKSPACEX_API_PORT=443',
    'LOCAL_RUNTIME_ALLOW_EGRESS=1',
  ].join('\n'), ({ path, dir }) => {
    // Intercept only process launch, not model responses. No stack or model runs.
    const preload = join(dir, 'capture-launch.mjs');
    const capture = join(dir, 'launch.json');
    writeFileSync(preload, `
      import cp from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      import { writeFileSync } from 'node:fs';
      cp.spawnSync = (command, args, options) => {
        writeFileSync(process.env.MODEL_CONFIG_CAPTURE_FILE, JSON.stringify({
          command, args,
          modelKeyPresent: options.env.DASHSCOPE_API_KEY === 'fixture-sensitive-key',
          modelOnly: options.env.WORKSPACEX_MODEL_ENV_ONLY,
          database: options.env.DATABASE_URL ?? null,
          port: options.env.WORKSPACEX_API_PORT ?? null,
          egress: options.env.LOCAL_RUNTIME_ALLOW_EGRESS ?? null,
        }));
        return { status: 17 };
      };
      syncBuiltinESMExports();
    `);
    const env = cleanEnv();
    for (const key of ['DATABASE_URL', 'WORKSPACEX_API_PORT', 'LOCAL_RUNTIME_ALLOW_EGRESS']) delete env[key];
    const run = spawnSync(process.execPath, ['--import', preload, 'scripts/real-model-config.mjs', '--smoke', '--model-env-file', path, '--lane', 'office'], {
      cwd: root, env: { ...env, MODEL_CONFIG_CAPTURE_FILE: capture }, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(run.status, 17);
    const launch = JSON.parse(readFileSync(capture, 'utf8'));
    assert.deepEqual(launch, {
      command: 'pnpm',
      args: ['exec', 'tsx', '.harness/scripts/with-test-isolation.ts', '--', 'bash', 'scripts/real-model-smoke.sh', 'office'],
      modelKeyPresent: true, modelOnly: '1', database: null, port: null, egress: null,
    });
    assert.ok(!run.stdout.includes(complete.DASHSCOPE_API_KEY));
    assert.equal(JSON.parse(run.stdout).modelAcceptance, 'not_run');
  });
});

test('quoted multiline or escaped model assignments are rejected without source echo', () => {
  for (const input of ['DASHSCOPE_API_KEY="sensitive\ncontinued"', 'DASHSCOPE_API_KEY=secret\\value', 'DASHSCOPE_MODEL="unterminated']) {
    const parsed = parseModelEnv(input);
    assert.equal(parsed.errors.length, 1);
    assert.ok(!JSON.stringify(parsed.errors).includes('sensitive'));
  }
});

test('pnpm public entry does not consume model file as its own Node env-file option', () => {
  withFile('', ({ path, dir }) => {
    const marker = join(dir, 'must-not-exist');
    writeFileSync(path, [
      ...Object.entries(complete).map(([key, value]) => `${key}=${value}`),
      `touch '${marker}'`,
      'DATABASE_URL=postgres://production.example/db',
    ].join('\n'));
    const run = spawnSync('pnpm', ['run', 'real-model:doctor', '--model-env-file', path], {
      cwd: root, env: cleanEnv(), encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(existsSync(marker), false);
    assert.ok(run.stdout.includes('"connectivity": "not_checked"'));
    assert.ok(!run.stdout.includes(complete.DASHSCOPE_API_KEY));
    assert.ok(!run.stdout.includes('production.example'));
  });
});

test('native development stack is an explicit isolated child, with no deployment fields imported', () => {
  withFile([
    ...Object.entries(complete).map(([key, value]) => `${key}=${value}`),
    'DATABASE_URL=postgres://production.example/db',
    'ENABLE_AIDT_MODULE=0', 'KERNEL_ALLOW_TEST_PRINCIPAL=0',
  ].join('\n'), ({ path, dir }) => {
    const preload = join(dir, 'capture-stack.mjs');
    const capture = join(dir, 'stack.json');
    writeFileSync(preload, `
      import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
      import {writeFileSync} from 'node:fs';
      cp.spawnSync=(command,args,options)=>{
        writeFileSync(process.env.MODEL_CONFIG_CAPTURE_FILE,JSON.stringify({command,args,
          marker:options.env.WORKSPACEX_REAL_MODEL_DEV_OPT_IN,
          webMode:options.env.REAL_MODEL_E2E_WEB_MODE,
          modelOnly:options.env.WORKSPACEX_MODEL_ENV_ONLY,
          database:options.env.DATABASE_URL??null, permission:options.env.KERNEL_ALLOW_TEST_PRINCIPAL??null,
          uvicorn:options.env.REAL_MODEL_E2E_UVICORN, work:options.env.REAL_MODEL_E2E_WORK_DIR}));
        return {status:23};
      };syncBuiltinESMExports();
    `);
    const env=cleanEnv(); delete env.DATABASE_URL; delete env.KERNEL_ALLOW_TEST_PRINCIPAL;
    const run=spawnSync(process.execPath,['--import',preload,'scripts/real-model-config.mjs','--stack','--prebuild','--model-env-file',path,'--work-dir',dir,'--uvicorn',join(dir,'uvicorn')],{
      cwd:root,env:{...env,MODEL_CONFIG_CAPTURE_FILE:capture},encoding:'utf8',timeout:10_000,
    });
    assert.equal(run.status,23);
    assert.deepEqual(JSON.parse(readFileSync(capture,'utf8')),{
      command:'pnpm',args:['exec','tsx','.harness/scripts/with-test-isolation.ts','--','tsx','scripts/real-model-aidt-stack.mjs'],
      marker:'1',webMode:'build-start',modelOnly:'1',database:null,permission:null,uvicorn:join(dir,'uvicorn'),work:dir,
    });
    assert.ok(!run.stdout.includes(complete.DASHSCOPE_API_KEY));
  });
});

test('incomplete native stack options do not launch any stack', () => {
  withFile(Object.entries(complete).map(([key,value])=>`${key}=${value}`).join('\n'),({path})=>{
    for(const args of [['--stack'],['--stack','--smoke']]) {
      const run=spawnSync(process.execPath,['scripts/real-model-config.mjs','--model-env-file',path,...args],{cwd:root,env:cleanEnv(),encoding:'utf8',timeout:10_000});
      assert.equal(run.status,2);
      assert.ok(run.stderr.includes('requires --work-dir'));
    }
  });
});

test('developer proxy preload is explicit and confined to the configured model origin', () => {
  const source=readFileSync(join(root,'scripts/real-model-proxy-preload.cjs'),'utf8');
  for(const enabled of [false,true]) {
    const calls=[];const original=(input,options)=>{calls.push({input,options});};
    const undici={fetch:original,ProxyAgent:class {constructor(){this.kind='configured-proxy';}}};
    const context={URL,__dirname:join(root,'scripts'),process:{env:{HTTPS_PROXY:'http://proxy.example:8080',KERNEL_MODEL_BASE_URL:'https://model.example/v1',...(enabled?{WORKSPACEX_REAL_MODEL_DEV_OPT_IN:'1'}:{})}},require:(name)=>name==='node:module'?{createRequire:()=>()=>undici}:{resolve}};
    runInNewContext(source,context);
    assert.equal(undici.fetch===original,!enabled);
    undici.fetch('https://model.example/v1/chat/completions',{dispatcher:'direct'});
    undici.fetch('http://127.0.0.1:3200/healthz',{dispatcher:'direct'});
    undici.fetch('https://other.example/v1/chat/completions',{dispatcher:'direct'});
    assert.equal(calls[0].options.dispatcher.kind,enabled?'configured-proxy':undefined);
    assert.equal(calls[1].options.dispatcher,'direct');
    assert.equal(calls[2].options.dispatcher,'direct');
  }
});
