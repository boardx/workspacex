import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {SCHEDULE_LIMITS,ScheduleToolRequest,SCHEDULE_TOOL_SCHEMAS,SCHEDULE_OUTPUT_SCHEMAS} from '../src/standard-schedule';
import {ScheduleCreateInput,ScheduleCancelInput} from '../src/standard-schedule';
const base={instruction:'Prepare the daily summary',timezone:'America/New_York',idempotencyKey:'00000000-0000-4000-8000-000000000001'};
it('accepts explicit once instants and IANA minute-level cron',()=>{
 expect(ScheduleCreateInput.safeParse({...base,trigger:'once',scheduleSpec:{at:'2027-01-01T09:00:00-05:00'}}).success).toBe(true);
 expect(ScheduleCreateInput.safeParse({...base,trigger:'cron',scheduleSpec:{expression:'30 9 * * 1-5'}}).success).toBe(true);
});
it('rejects authority identity, naive dates, invalid timezone and second cron',()=>{
 for(const delta of [{orgId:'other'},{timezone:'Not/AZone'},{scheduleSpec:{expression:'0 30 9 * * *'}}])expect(ScheduleCreateInput.safeParse({...base,trigger:'cron',scheduleSpec:{expression:'30 9 * * *'},...delta}).success).toBe(false);
 expect(ScheduleCreateInput.safeParse({...base,trigger:'once',scheduleSpec:{at:'2027-01-01T09:00:00'}}).success).toBe(false);
 expect(ScheduleCancelInput.safeParse({scheduleId:base.idempotencyKey,expectedRevision:0}).success).toBe(false);
});
it('keeps model parameters an object and rejects mismatched trigger specs',()=>{
 expect(ScheduleCreateInput.safeParse({...base,trigger:'once',scheduleSpec:{expression:'30 9 * * *'}}).success).toBe(false);
 expect(ScheduleCreateInput.safeParse({...base,trigger:'cron',scheduleSpec:{at:'2027-01-01T09:00:00Z'}}).success).toBe(false);
});

it('generated Python protocol equals shared contracts and persistent instruction constraint',()=>{
 const options={target:'jsonSchema7',$refStrategy:'none'} as const;
 const expected={limits:SCHEDULE_LIMITS,input:zodToJsonSchema(ScheduleToolRequest,options),tools:Object.fromEntries(Object.entries(SCHEDULE_TOOL_SCHEMAS).map(([name,schema])=>[name,zodToJsonSchema(schema,options)])),outputs:Object.fromEntries(Object.entries(SCHEDULE_OUTPUT_SCHEMAS).map(([name,schema])=>[name,zodToJsonSchema(schema,options)]))};
 expect(JSON.parse(readFileSync(new URL('../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_schedule_schema.json',import.meta.url),'utf8'))).toEqual(expected);
 expect(readFileSync(new URL('../../../apps/api/migrations/20260909050000_standard_schedules.sql',import.meta.url),'utf8')).toContain(`length(instruction)<=${SCHEDULE_LIMITS.maxInstructionChars}`);
});
