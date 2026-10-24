import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
it('executes actual crypto/filesystem/frame/cancellation counterexamples',()=>{
 const result=spawnSync(process.execPath,['--test','.harness/scripts/vm/cn-auto-evidence-stage.selftest.mjs'],{encoding:'utf8',timeout:20000});
 expect(result.status,result.stdout+result.stderr).toBe(0);expect(result.stdout).toContain('# fail 0');
});
it('keeps long Devapp work off the CN runner and stages signed Devapp evidence after preparation',()=>{
 const workflow=readFileSync('.github/workflows/prepare-cn-release.yml','utf8');
 expect(workflow).toContain('needs: [source-bundle, devapp-exact-evidence]');
 expect(workflow).toMatch(/devapp-exact-evidence:[\s\S]*?runs-on: ubuntu-latest[\s\S]*?timeout-minutes: 95/);
 expect(workflow).toContain("needs.devapp-exact-evidence.result == 'success'");expect(workflow).toContain("needs.devapp-exact-evidence.result == 'skipped'");
 const prepare=workflow.indexOf('sudo -n /usr/local/bin/workspacex-cn-deploy --prepare'),stage=workflow.indexOf('sudo -n /usr/local/bin/workspacex-cn-deploy --auto-stage-evidence'),verify=workflow.indexOf('sudo -n /usr/local/bin/workspacex-cn-verify-promotion "${revision}"');
 expect(prepare).toBeGreaterThan(0);expect(stage).toBeGreaterThan(prepare);expect(verify).toBeGreaterThan(stage);
 expect(workflow).not.toContain('id-token: write');expect(workflow).not.toContain('ACTIONS_ID_TOKEN_REQUEST');expect(workflow).not.toContain('cn-governance-broker');
 expect(workflow).toContain('devapp-evidence.bin');expect(workflow).not.toContain('governance_json:');
 const deploy=readFileSync('.harness/scripts/vm/deploy-cn-production.sh','utf8');expect(deploy).toMatch(/--auto-stage-evidence[\s\S]*?exec 9<>[\s\S]*?flock -n 9[\s\S]*?cn-auto-evidence-stage.mjs/);
});
it.skipIf(process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true')('executes actual root inherited-lock and inode substitution counterexamples',()=>{
 const result=spawnSync('docker',['run','--rm','--user','0','--network','none','--memory','256m','--cpus','1','--pids-limit','64','-v',process.cwd()+':/source:ro','python:3.12-bookworm','python3','-B','/source/.harness/scripts/vm/cn-auto-evidence-stage-lock.selftest.py'],{encoding:'utf8',timeout:90000});
 expect(result.status,result.stdout+result.stderr).toBe(0);expect(result.stdout).toContain('CN_AUTO_EVIDENCE_LOCK_BOUNDARIES_PASSED');
},95000);
