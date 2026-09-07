import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkScheduleNotifications} from '../lib/schedule-notifications-boundary.mjs';
const source=readFileSync(new URL('../../src/infrastructure/agent-run/pg-schedule-notifications.ts',import.meta.url),'utf8');
test('current scheduler fact projection has a real membership and recipient boundary',()=>assert.deepEqual(checkScheduleNotifications(source),[]));
for(const [before,after] of [
 ['private async withViewer','async withViewer'],['if(!await this.identity.findOrgMembership(viewer.userId,viewer.orgId))','if(false)'],
 ['return this.withViewer(viewer,async s=>','return this.db.withTenant(viewer.orgId,async s=>'],
 ['WHERE org_id=$1 AND user_id=$2','WHERE org_id=$1'],['[viewer.orgId,viewer.userId,input.factId]','[viewer.orgId,"someone",input.factId]'],
 ['SELECT id,last_occurrence_id,failure_code','SELECT instruction,id,last_occurrence_id,failure_code'],
 ['AND last_occurrence_id=$4::uuid AND failure_code=$5', 'AND true'],['COALESCE(notification_accepted_at,now())','now()'],
 ['if(result.rows.length!==1)','if(false)'],['ORDER BY id LIMIT $4','ORDER BY id'],
])test('reject '+before,()=>{const changed=source.replace(before,after);assert.notEqual(changed,source);assert.ok(checkScheduleNotifications(changed).length);});
