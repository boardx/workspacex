import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkStandardSchedule} from '../lib/standard-schedule-boundary.mjs';
const source=readFileSync(new URL('../../src/infrastructure/agent-run/pg-standard-schedule.ts',import.meta.url),'utf8');
test('real scheduler authority and private dispatch boundary',()=>assert.deepEqual(checkStandardSchedule(source),[]));
for(const [before,after] of [
 ['withAuthorizedStandardToolRun(this.deps.db','bypass(this.deps.db'],['authorizeSubtaskParent(this.deps.visibility','skip(this.deps.visibility'],
 ['ScheduleToolRequest.parse(raw)','raw'],['private async create','async create'],['wake.parse(job.data)','job.data'],
 ['WHERE org_id=$1 AND user_id=$2','WHERE user_id=$2'],['[orgId,data.scheduleId]','["other",data.scheduleId]'],
 ["visible?.kind==='allow'?row.instruction.slice(0,SCHEDULE_LIMITS.maxSummaryChars):'任务当前不可访问'",'row.instruction'],
 ["if(row.status!=='active')","if(false)"],['instruction:row.instruction,occurrenceId:job.id','instruction:row.instruction,occurrenceId:randomUUID()'],
 ['id=$2::uuid FOR UPDATE','id=$2::uuid'],['this.deps.provider.inTransaction(s,','Promise.resolve(s,'],
])test('reject '+before,()=>{assert.notEqual(source.replace(before,after),source);assert.ok(checkStandardSchedule(source.replace(before,after)).length);});
