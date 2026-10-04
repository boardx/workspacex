import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const root=process.env.BOARD_CI_MAPPING_ROOT??resolve(import.meta.dirname,'../../..');
const {parse}=createRequire(resolve(root,'package.json'))('yaml');
const read=p=>readFileSync(resolve(root,p),'utf8');
const workflow=parse(read('.github/workflows/board-acceptance.yml'));
const policy=JSON.parse(read('.harness/config/ci-check-policy.json'));
const scripts=JSON.parse(read('apps/web/package.json')).scripts;
const producer='pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web run ci:board:visual';
function validate(w,p){
 assert.deepEqual(p.deferredChecks,['visual-deferred']);
 assert.ok(Object.hasOwn(w.on,'pull_request'));
 assert.deepEqual(w.on.push.branches,['main']);
 const functional=w.jobs['board-ui-functional'],visual=w.jobs['visual-deferred'];
 assert.ok(functional&&visual);
 assert.equal(functional.needs,'scope');
 assert.equal(functional.if,"needs.scope.outputs.board == 'true'");
 assert.equal(visual.if,"github.event_name == 'workflow_dispatch' && inputs.acceptance_category == 'visual-deferred'");
 for(const [job,mode] of [[functional,'functional'],[visual,'all']]){
  assert.notEqual(job['continue-on-error'],true);
  const producers=job.steps.filter(s=>s.run?.includes('ci:board:visual'));
  assert.equal(producers.length,1);
  const step=producers[0];
  assert.equal(step.run,producer);
  assert.equal(step.env.BOARD_OBSERVATION_MODE,mode);
  assert.equal(step.if,undefined);
  assert.notEqual(step['continue-on-error'],true);
  assert.deepEqual(Object.keys(step.env).sort(),['BOARD_OBSERVATION_MODE','TMPDIR']);
 }
 for(const [name,job] of Object.entries(w.jobs)){
  if(name==='visual-deferred')continue;
  assert.ok(!p.deferredChecks.includes(name));
  assert.ok(!job.steps?.some(s=>s.env?.BOARD_OBSERVATION_MODE==='all'&&s.run?.includes('ci:board:visual')));
 }
 assert.equal(scripts['ci:board:visual'],'node scripts/run-board-ci-lane.mjs visual -- pnpm --filter web exec playwright test --config e2e/board-visual-accessibility-acceptance.config.ts');
}
const clone=()=>structuredClone(workflow);
test('actual parsed workflow keeps functional blocking and manual full visual isolated',()=>validate(workflow,policy));
test('old mixed whole visual job cannot be reclassified deferred',()=>{
 const w=clone();delete w.jobs['board-ui-functional'];w.jobs['visual-deferred'].if="needs.scope.outputs.board == 'true'";
 assert.throws(()=>validate(w,policy));
});
test('functional partial-case, whole-step skip, weak mode and continue-on-error reject',()=>{
 for(const mutate of [s=>s.run+=' --grep compact',s=>s.if='false',s=>s.env.BOARD_OBSERVATION_MODE='all',s=>s['continue-on-error']=true,s=>s.env.SKIP_NATIVE='1']){
  const w=clone();mutate(w.jobs['board-ui-functional'].steps.find(s=>s.run===producer));assert.throws(()=>validate(w,policy));
 }
});
test('Native or broad visual names cannot inherit deferred status',()=>{
 for(const name of ['native-board','visual','board-ui-functional'])assert.throws(()=>validate(workflow,{...policy,deferredChecks:[name]}));
});
test('native jobs retain complete commands and cannot claim deferred coverage',()=>{
 const native=parse(read('.github/workflows/board-native-acceptance.yml'));
 const commands=Object.values(native.jobs).flatMap(j=>j.steps??[]).filter(s=>s.run?.includes('run-board-native-acceptance.mjs')).map(s=>s.run.trim());
 assert.equal(commands.length,3);
 assert.deepEqual(commands.map(c=>c.match(/--config (\S+)/)?.[1]).sort(),['e2e/board-connector-existing-runtime.config.ts','e2e/board-files-completion.config.ts','e2e/board-peer-existing-runtime.config.ts'].sort());
 for(const c of commands)assert.match(c,/^node apps\/web\/scripts\/run-board-native-acceptance\.mjs -- pnpm --filter web exec playwright test --config e2e\/board-[a-z-]+\.config\.ts$/);
});
