import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

const vm=import.meta.dirname;
const script=join(vm,'real-model-chat-evidence.sh');

/**
 * 新开 issue（devapp 第一次真正跑通登录/权限后才暴露）：`preflight` 写出的
 * `$RUNNER_TEMP/real-model-e2e.env` 不是被 dotenv 解析的——workflow 里用
 * `set -a; . "$file"; set +a` 当**普通 shell 脚本**执行它。裸写
 * `echo "KEY=${VALUE}"` 在值带空格时（例如默认 prompt「生成一个 pdf，总结你可以
 * 做的事情」）会把 `=` 之后的内容拆成第二条要执行的命令，`source` 时直接
 * `command not found`，job 以 exit 127 崩掉。
 *
 * 这里跑真实的 `preflight` 子命令（不是重实现一份编码逻辑），用一批刻意刁钻的
 * 值（空格 / 逗号 / 中文 / 值本身带单引号 / 空值）喂给它，再真的 `source`
 * 产出的文件，断言：① source 不报错；② 每个变量原样还原。
 */
describe('real-model-chat-evidence.sh preflight 写出的 env 文件可被安全 source',()=>{
  it('值带空格/逗号/中文/单引号时仍能 source 成功且原样还原', () => {
    const dir=mkdtempSync(join(tmpdir(),'real-model-env-test-'));
    const runEnvFile=join(dir,'run.env');
    const evidenceDir=join(dir,'evidence');
    try {
      const email='fake+test user@example.com'; // 空格
      const password="p'a ss,word 密码"; // 单引号 + 逗号 + 中文
      const prompt='生成一个 pdf，总结你可以做的事情'; // 中文 + 逗号 + 空格（默认值本身）

      const preflight=spawnSync('bash',[script,'preflight'],{
        encoding:'utf8',
        env:{
          ...process.env,
          REAL_MODEL_E2E_ENV_FILE:'/nonexistent-real-model-e2e.env', // 走「已导出变量」分支
          REAL_MODEL_E2E_EMAIL:email,
          REAL_MODEL_E2E_PASSWORD:password,
          REAL_MODEL_E2E_PROMPT:prompt,
          REAL_MODEL_RUN_ENV_FILE:runEnvFile,
          REAL_MODEL_E2E_EVIDENCE_DIR:evidenceDir,
          DEPLOY_ENV_FILE:'/nonexistent-deploy.env',
        },
      });

      expect(preflight.status,`preflight stderr:\n${preflight.stderr}`).toBe(0);

      const written=readFileSync(runEnvFile,'utf8');
      // 值本身绝不回显到 stdout/stderr（preflight 自己的既有承诺，这里顺带守住）。
      expect(preflight.stdout).not.toContain(password);
      expect(preflight.stderr).not.toContain(password);

      // -eo pipefail 与 GitHub Actions 默认的 bash `run:` 步骤同一套开关
      // （`bash --noprofile --norc -eo pipefail {0}`）——真实车道就是靠 `-e`
      // 让 source 阶段的报错直接终止整个 job（127），这里必须同款复现。
      const sourceProbe=spawnSync('bash',['-c',
        `set -eo pipefail; set -a; . "$1"; set +a; printf '%s\\n' "$REAL_MODEL_E2E_EMAIL" "$REAL_MODEL_E2E_PASSWORD" "$REAL_MODEL_E2E_PROMPT"`,
        '--',runEnvFile,
      ],{encoding:'utf8'});

      expect(sourceProbe.status,`source stderr:\n${sourceProbe.stderr}\nfile:\n${written}`).toBe(0);
      const [gotEmail,gotPassword,gotPrompt]=sourceProbe.stdout.split('\n');
      expect(gotEmail).toBe(email);
      expect(gotPassword).toBe(password);
      expect(gotPrompt).toBe(prompt);
    } finally {
      rmSync(dir,{recursive:true,force:true});
    }
  });

  it('反证：旧的裸拼接写法在同一个值上会让 source 失败（锁定缺陷形状本身）',()=>{
    const dir=mkdtempSync(join(tmpdir(),'real-model-env-oldshape-'));
    const oldFile=join(dir,'old.env');
    try {
      const prompt='生成一个 pdf，总结你可以做的事情';
      const write=spawnSync('bash',['-c','printf "REAL_MODEL_E2E_PROMPT=%s\\n" "$1" > "$2"','--',prompt,oldFile]);
      expect(write.status).toBe(0);
      const sourceOld=spawnSync('bash',['-c','set -eo pipefail; set -a; . "$1"; set +a','--',oldFile],{encoding:'utf8'});
      expect(sourceOld.status).not.toBe(0);
      expect(sourceOld.stderr).toContain('command not found');
    } finally {
      rmSync(dir,{recursive:true,force:true});
    }
  });
});
