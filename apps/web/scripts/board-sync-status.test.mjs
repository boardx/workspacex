import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tsImport} from 'tsx/esm/api';
const {BOARD_SYNCED_STATUS}=await tsImport(new URL('../e2e/support/board-sync-status.ts',import.meta.url).href,import.meta.url);
test('accepts exact idle/acknowledged status including server sequence',()=>{
 for(const value of ['已同步','已同步 · 序列 0','已同步 · 序列 123'])assert.equal(BOARD_SYNCED_STATUS.test(value),true,value);
});
test('does not treat pending, disconnect, or malformed sequence as acknowledged',()=>{
 for(const value of ['正在连接','1 项修改等待服务器确认','连接中断 · 第 1 次重连 · 0 项修改待确认','已同步 · 序列 -1','已同步 · 序列 1.5','已同步 · 序列','已同步 · 序列 1 · 2 项修改等待服务器确认','未已同步'])assert.equal(BOARD_SYNCED_STATUS.test(value),false,value);
});
test('all three regressions retain bounded visible acknowledgement assertions',()=>{
 for(const [name,count] of [['board-library-management',6],['board-thinking-input',4],['board-visual-content',4]]){
  const source=readFileSync(new URL(`../e2e/${name}.spec.ts`,import.meta.url),'utf8');
  assert.equal(source.match(/getByText\(BOARD_SYNCED_STATUS\)\)\.toBeVisible\(\{ timeout: 30_000 \}\)/g)?.length,count);
  assert(!source.includes('/^已同步$/'));
 }
});
