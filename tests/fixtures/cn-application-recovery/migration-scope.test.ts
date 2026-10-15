import {test} from 'node:test';
import assert from 'node:assert/strict';
import {migrationScope,reviewedSuffix} from './migration-scope';
import {migrationFiles} from '../../../apps/api/src/infrastructure/db/migrator';
test('actual migration catalog keeps the historical prefix and includes every reviewed new migration',()=>{
 const names=migrationFiles(),scope=migrationScope(names);
 assert.deepEqual(names.slice(scope.originalCount),scope.pending);
 assert.equal(scope.last,names.at(-1));
 assert.equal(names.slice(0,scope.originalCount).includes(reviewedSuffix[0]!),false);
 assert.equal(scope.originalCount+scope.pending.length,names.length);
});
test('future or missing migrations cannot silently alter the tested upgrade',()=>{
 const names=['20200101000000_prefix.sql',...reviewedSuffix];
 assert.equal(migrationScope(names).originalCount,1);
 assert.throws(()=>migrationScope([...names,'20261015000000_unreviewed.sql']),/UNREVIEWED/);
 assert.throws(()=>migrationScope(names.slice(0,-1)),/UNREVIEWED/);
 assert.throws(()=>migrationScope(names.filter(n=>n!==reviewedSuffix[0])),/HISTORICAL/);
 assert.throws(()=>migrationScope([...names,names.at(-1)!]),/SORTED_UNIQUE/);
});
