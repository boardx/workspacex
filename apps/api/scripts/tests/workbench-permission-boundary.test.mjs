import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORKBENCH_BOUNDARIES, checkWorkbenchPermissionBoundary as check } from '../lib/workbench-permission-boundary.mjs';
for (const path of WORKBENCH_BOUNDARIES) {
  const source = readFileSync(new URL('../../'+path, import.meta.url),'utf8');
  test(path+' existing boundary recognized',()=>assert.deepEqual(check(path,source),[]));
  if(path.endsWith('pg-database.ts')) {
    for(const [from,to] of [['SELECT id FROM agent_runs','SELECT * FROM agent_runs'],['orgId!==lease.orgId','false'],['lease_expires_at>now()','true']])
      test('reject lease '+from,()=>assert.ok(check(path,source.replace(from,to)).length));
  } else {
    for(const from of ['await this.authorize(orgId,userId,threadId);','await this.authorize(orgId,userId,threadId,true);','access.kind!=="allow"','userId:row.actor_id'])
      test('reject queue '+from,()=>assert.ok(check(path,source.replace(from,'/* removed */')).length));
  }
}
