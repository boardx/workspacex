import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const script=resolve(import.meta.dirname,'s016-asr-real-evidence.sh');

describe('S016 ASR evidence preflight',()=>{
  it('reports every missing ASR key without reading a text-model key',()=>{
    const root=mkdtempSync(join(tmpdir(),'s016-missing-')),evidence=join(root,'evidence');
    const result=spawnSync('bash',[script,'preflight'],{encoding:'utf8',env:{...process.env,RUNNER_TEMP:root,WX_ASR_REAL_EVIDENCE:evidence,S016_ASR_ENV_FILE:join(root,'absent.env'),DASHSCOPE_API_KEY:'text-model-key-must-not-count'}});
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('DEPLOY_ENV_READABLE=MISSING\nKERNEL_ASR_PROVIDER=MISSING\nKERNEL_ASR_BASE_URL=MISSING\nKERNEL_ASR_API_KEY=MISSING\nKERNEL_ASR_MODEL=MISSING\nASR_CONFIG_READY=MISSING\n');
    expect(readFileSync(join(evidence,'01-preflight.txt'),'utf8')).toBe(result.stdout);
    expect(result.stdout+result.stderr).not.toContain('text-model-key-must-not-count');
  });

  it('reports only PRESENT and writes credentials to a private ephemeral file',()=>{
    const root=mkdtempSync(join(tmpdir(),'s016-present-')),evidence=join(root,'evidence'),envFile=join(root,'deploy.env');
    const secret='asr-secret-that-must-not-appear';
    writeFileSync(envFile,[
      'KERNEL_ASR_PROVIDER=dashscope',
      'KERNEL_ASR_BASE_URL=wss://example.invalid/asr',
      `KERNEL_ASR_API_KEY=${secret}`,
      'KERNEL_ASR_MODEL=qwen-asr',
    ].join('\n'));
    const output=execFileSync('bash',[script,'preflight'],{encoding:'utf8',env:{...process.env,RUNNER_TEMP:root,WX_ASR_REAL_EVIDENCE:evidence,S016_ASR_ENV_FILE:envFile}});
    expect(output).toBe('DEPLOY_ENV_READABLE=PRESENT\nKERNEL_ASR_PROVIDER=PRESENT\nKERNEL_ASR_BASE_URL=PRESENT\nKERNEL_ASR_API_KEY=PRESENT\nKERNEL_ASR_MODEL=PRESENT\nASR_CONFIG_READY=PRESENT\n');
    expect(output).not.toContain(secret);
    expect(statSync(join(root,'s016-asr-real.env')).mode&0o777).toBe(0o600);
  });
});
