import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { compareHistoryObjects, historyObjects } from '../../src/domain/whiteboard/history-projection';

const object=(id:string,text:string,parentId:string|null=null,connector?:{from:string;to:string}):WhiteboardObject=>({id,schemaVersion:1,kind:connector?'connector':'sticky',geometry:{x:0,y:0,width:100,height:80,rotation:0},text,style:{fill:'#fff'},parentId,orderKey:id,...(connector?{connector}:{})});
describe('whiteboard history behavior',()=>{
  it('reports added, modified and deleted objects with relationship context',()=>{
    const before=[object('frame','Frame'),object('old','Old','frame'),object('line','',null,{from:'old',to:'missing'})];
    const after=[object('frame','Frame renamed'),object('new','New','gone')];
    const changes=compareHistoryObjects(before,after);
    expect(changes.map(change=>[change.id,change.change])).toEqual([['frame','modified'],['line','deleted'],['new','added'],['old','deleted']]);
    expect(changes.find(change=>change.id==='line')?.before?.connector).toMatchObject({fromMissing:false,toMissing:true});
    expect(historyObjects(after).find(item=>item.id==='new')?.parentMissing).toBe(true);
  });
  it('keeps PostgreSQL history tables metadata-only and immutable to app_rw',()=>{
    const sql=readFileSync(new URL('../../migrations/20260924000300_whiteboard_checkpoints.sql',import.meta.url),'utf8');
    expect(sql).toContain('blob_key text NOT NULL');
    expect(sql).toContain('content_sha256 text NOT NULL');
    expect(sql).not.toMatch(/snapshot\s+bytea|snapshot_base64/i);
    expect(sql).toContain('GRANT SELECT, INSERT ON whiteboard_checkpoints, whiteboard_checkpoint_restores TO app_rw');
    expect(sql).not.toMatch(/GRANT[^;]*(?:UPDATE|DELETE)[^;]*whiteboard_checkpoint/i);
  });
});
