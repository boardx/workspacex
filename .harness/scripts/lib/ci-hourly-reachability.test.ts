import {expect,it} from 'vitest';
import {scheduledJobLabels} from './ci-hourly-reachability.mjs';
const policy={version:5,fullRegression:{workflowPath:'.github/workflows/harness-acceptance.yml',cron:'17 * * * *'}};
it('marks only genuinely scheduled full jobs and reachable reusable specialists, not manual/UI-only subsets',()=>{
 const w=new Map([['harness-acceptance.yml',{on:{schedule:[{cron:'17 * * * *'}]},jobs:{root:{},ui:{if:"needs.doc-smoke-scope.outputs.mode == 'targeted-ui'"},manual:{if:"github.event_name == 'workflow_dispatch'"},special:{uses:'./.github/workflows/special.yml'}}}],['special.yml',{on:{workflow_call:{}},jobs:{scope:{outputs:{changed:'${{ steps.scope.outputs.changed }}'},steps:[{run:"echo 'changed=true' >> \"$GITHUB_OUTPUT\""}]},test:{needs:['scope'],if:"needs.scope.outputs.changed == 'true'"}}}]]);
 const labels=scheduledJobLabels(w,policy);expect(labels.has('harness-acceptance.yml#root')).toBe(true);expect(labels.has('special.yml#test')).toBe(true);expect(labels.has('harness-acceptance.yml#ui')).toBe(false);expect(labels.has('harness-acceptance.yml#manual')).toBe(false);expect(scheduledJobLabels(w,{...policy,version:4}).size).toBe(0);
});
