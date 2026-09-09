import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkNotificationCenter,checkNotificationDedupIndex,checkNotifyingRunEventBus} from '../lib/notification-center-boundary.mjs';
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

// #3224：ON CONFLICT DO NOTHING 的去重能力全部寄托在这条唯一索引上，删了/改窄了都必须红。
const migration=readFileSync(new URL('../../migrations/20260910040000_user_notifications.sql',import.meta.url),'utf8');
test('dedup index is present as a partial unique index',()=>assert.deepEqual(checkNotificationDedupIndex(migration),[]));
for(const [name,mangled] of [
 ['索引整条删掉',migration.split('\n').filter(l=>!l.includes('UNIQUE INDEX')).join('\n')],
 ['索引建到别的列上',migration.replace('(user_id,source_key)','(user_id,created_at)')],
 ['退化成全表唯一索引',migration.replace(' WHERE source_key IS NOT NULL;',';')],
])test(`dedup index counterexample: ${name}`,()=>assert.notDeepEqual(checkNotificationDedupIndex(mangled),[]));
