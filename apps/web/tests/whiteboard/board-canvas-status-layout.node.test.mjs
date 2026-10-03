import assert from 'node:assert/strict';
import {test} from 'node:test';
import {boardCanvasStatusLayout} from '../../components/whiteboard/board-canvas-status-layout.ts';

test('status uses the measured dock clearance rather than covering its row',()=>{
  const insets={left:32,right:32,top:96,bottom:176};
  const layout=boardCanvasStatusLayout(insets);
  assert.equal(layout.bottom,insets.bottom);
});

test('status stays horizontally bounded at both narrow and desktop widths',()=>{
  for(const width of [390,1440]){
    const insets={left:Math.min(32,width/10),right:Math.min(32,width/10),top:96,bottom:96};
    const layout=boardCanvasStatusLayout(insets);
    assert.equal(layout.left,insets.left);
    assert.equal(layout.right,insets.right);
    assert.equal(layout.transform,undefined);
    assert.ok(width-layout.left-layout.right>0);
  }
});
