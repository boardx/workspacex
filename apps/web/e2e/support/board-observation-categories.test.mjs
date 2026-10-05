import {test} from 'node:test';
import assert from 'node:assert/strict';
import {categoryEnabled,observationMode,observationCategories,observationArtifactKinds} from './board-observation-categories.mjs';
test('default and all retain every category',()=>{assert.equal(observationMode(undefined),'all');for(const category of Object.keys(observationCategories))assert.equal(categoryEnabled(category,'all'),true);});
test('functional suppresses screenshots while retaining all functional categories',()=>{for(const category of ['screenshot','pixel-comparison'])assert.equal(categoryEnabled(category,'functional'),false);for(const category of ['hit-test-measurement','keyboard-focus','axe','canonical-save-sync-permission'])assert.equal(categoryEnabled(category,'functional'),true);});
test('unknown modes and categories fail closed',()=>{for(const value of ['', 'visual', 'skip', 'true'])assert.throws(()=>observationMode(value),/INVALID_BOARD/);assert.throws(()=>categoryEnabled('permissions','functional'),/UNKNOWN_BOARD/);assert.throws(()=>categoryEnabled('screenshot','skip'),/INVALID_BOARD/);});

test('artifact kinds derive from the same validated mode and reject unknown mode',()=>{
 assert.deepEqual(observationArtifactKinds('all'),{report:'board-visual-accessibility',bundle:'board-visual-accessibility-bundle'});
 assert.deepEqual(observationArtifactKinds('functional'),{report:'board-functional-accessibility',bundle:'board-functional-accessibility-bundle'});
 assert.throws(()=>observationArtifactKinds('skip'),/INVALID_BOARD/);
});
