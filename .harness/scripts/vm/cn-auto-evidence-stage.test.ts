import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
it('executes actual crypto/filesystem/frame/cancellation counterexamples',()=>{
 const result=spawnSync(process.execPath,['--test','.harness/scripts/vm/cn-auto-evidence-stage.selftest.mjs'],{encoding:'utf8',timeout:20000});
 expect(result.status,result.stdout+result.stderr).toBe(0);expect(result.stdout).toContain('# fail 0');
});
it('keeps long Devapp work off the CN runner and stages signed Devapp evidence after preparation',()=>{
 const workflow=readFileSync('.github/workflows/prepare-cn-release.yml','utf8');
 expect(workflow).toContain('needs: [source-bundle, candidate-ci, devapp-exact-evidence]');
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

it('waits for candidate CI independently before Devapp and admits only complete job outcomes',()=>{
 const workflow=createRequire(import.meta.url)('yaml').parse(readFileSync('.github/workflows/prepare-cn-release.yml','utf8'));
 const jobs=workflow.jobs,ci=jobs['candidate-ci'],devapp=jobs['devapp-exact-evidence'],source=jobs['source-bundle'],build=jobs['build-candidate'];
 expect(ci['runs-on']).toBe('ubuntu-latest');expect(ci['timeout-minutes']).toBe(100);
 expect(ci.permissions).toEqual({contents:'read',actions:'read'});
 const wait=ci.steps.find((step: {run?:string})=>step.run?.endsWith(' wait-candidate-ci'));
 expect(wait.env).toEqual({GH_TOKEN:'${{ github.token }}',RELEASE_SHA:'${{ inputs.release_sha }}',EVIDENCE_ATTEMPT:'gha-${{ github.run_id }}-${{ github.run_attempt }}',CANDIDATE_REF:'refs/heads/main-cn'});
 expect(ci.needs).toBeUndefined();expect(source.needs).toBeUndefined();
 expect(devapp.needs).toEqual(['candidate-ci']);expect(devapp.if).toContain("needs.candidate-ci.result == 'success'");
 expect(ci.if).toContain('inputs.auto_promote');expect(devapp.if).toContain('inputs.auto_promote');
 expect(devapp['timeout-minutes']).toBe(95);expect(build['timeout-minutes']).toBe(45);
 expect(build.needs).toEqual(['source-bundle','candidate-ci','devapp-exact-evidence']);
 // Evaluate the actual workflow expression against every dependency outcome;
 // manual must skip all cloud jobs, auto must successfully finish all three.
 for(const auto of [false,true])for(const sourceResult of ['success','skipped','failure','cancelled'])for(const ciResult of ['success','skipped','failure','cancelled'])for(const devappResult of ['success','skipped','failure','cancelled']){
  const results:Record<string,string>={'source-bundle':sourceResult,'candidate-ci':ciResult,'devapp-exact-evidence':devappResult};
  const expression=build.if.replace(/always\(\)/g,'true').replace(/cancelled\(\)/g,'false').replace(/github.event_name/g,JSON.stringify('workflow_dispatch')).replace(/github.ref/g,JSON.stringify('refs/heads/main')).replace(/inputs.auto_promote/g,String(auto)).replace(/needs\.([a-z-]+)\.result/g,(_:string,key:string)=>JSON.stringify(results[key]));
  expect(Function('return ('+expression+')')(),JSON.stringify({auto,results})).toBe(Object.values(results).every(result=>result===(auto?'success':'skipped')));
 }
});
