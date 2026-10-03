import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rotatedAnchorPoint} from '@repo/whiteboard-core';
import {BOARD_SYNCED_STATUS} from './board-acceptance-support';

test('UNIT sync ACK matches only committed status labels',()=>{
  for(const label of ['已同步','已同步 · 序列 0','已同步 · 序列 123'])assert(BOARD_SYNCED_STATUS.test(label));
  for(const label of ['正在同步','未同步','已同步中','已同步 · 序列 x','已同步 · 序列 -1','已同步 · 序列 \\d'])assert(!BOARD_SYNCED_STATUS.test(label));
});

test('UNIT left connector anchor preserves the canonical top-left rotation origin',()=>{
  for(const rotation of [0,90,45]){
    const geometry={x:100,y:200,width:180,height:80,rotation};
    const radians=rotation*Math.PI/180,point=rotatedAnchorPoint({geometry},'left');
    assert(Math.abs(point.x-(100-40*Math.sin(radians)))<1e-8);
    assert(Math.abs(point.y-(200+40*Math.cos(radians)))<1e-8);
    if(rotation!==0)assert(Math.hypot(point.x-(190-90*Math.cos(radians)),point.y-(240-90*Math.sin(radians)))>1);
  }
});
