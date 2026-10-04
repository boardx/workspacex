const {test}=require('node:test'),assert=require('node:assert/strict');const {aggregate}=require('./cn-maintenance-drain.cjs');
test('all unfinished status classes block drain',()=>assert.deepEqual(aggregate([{status:'paused',count:'2'},{status:'awaiting_tool_permission',count:'3'},{status:'queued',count:'1'},{status:'writeback_pending',count:'4'}]),{queued:1,running:5,writebackPending:4}));
test('terminal status does not block',()=>assert.deepEqual(aggregate([{status:'succeeded',count:'2'},{status:'cancelled',count:'3'}]),{queued:0,running:0,writebackPending:0}));
test('unknown and duplicate state reject',()=>{assert.throws(()=>aggregate([{status:'new_status',count:'0'}]));assert.throws(()=>aggregate([{status:'running',count:'0'},{status:'running',count:'0'}]));});
test('unsafe count rejects',()=>assert.throws(()=>aggregate([{status:'running',count:'9007199254740992'}])));
