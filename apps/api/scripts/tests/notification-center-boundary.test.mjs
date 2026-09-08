import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkNotificationCenter,checkNotifyingRunEventBus} from '../lib/notification-center-boundary.mjs';
const center=readFileSync(new URL('../../src/infrastructure/notifications/pg-notification-center.ts',import.meta.url),'utf8');
const bus=readFileSync(new URL('../../src/infrastructure/notifications/notifying-run-event-bus.ts',import.meta.url),'utf8');
test('notification center reads are recipient-scoped',()=>assert.deepEqual(checkNotificationCenter(center),[]));
test('run status push resolves only the run author',()=>assert.deepEqual(checkNotifyingRunEventBus(bus),[]));
for(const [before,after] of [
 ['WHERE user_id=$1 AND (org_id IS NULL OR org_id=$2) ORDER BY','WHERE (org_id IS NULL OR org_id=$2) ORDER BY'],
 ['[viewer.userId, viewer.orgId, NOTIFICATION_PAGE_SIZE]','["someone", viewer.orgId, NOTIFICATION_PAGE_SIZE]'],
 ['LIMIT $3','LIMIT 100000'],['ON CONFLICT DO NOTHING',''],
 ['if (input.orgId) await this.db.withTenant(input.orgId, run); else await this.db.withoutTenant(run);','await this.db.withoutTenant(run);'],
 ['NotificationReadInput.parse(raw)','raw'],
])test('center rejects '+before,()=>{const changed=center.replace(before,after);assert.notEqual(changed,center);assert.ok(checkNotificationCenter(changed).length);});
for(const [before,after] of [
 ["AND m.author_kind='human'",''],['WHERE r.org_id=$1 AND r.id=$2','WHERE r.id=$2'],
 ['SELECT m.author_id, r.thread_id, t.title FROM','SELECT m.author_id, m.body, r.thread_id, t.title FROM'],
 ['private async notify','async notify'],['userId: row.author_id, kind: "task"','userId: "everyone", kind: "task"'],
])test('bus rejects '+before,()=>{const changed=bus.replace(before,after);assert.notEqual(changed,bus);assert.ok(checkNotifyingRunEventBus(changed).length);});
