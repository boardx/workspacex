import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { compareHistoryObjects, compareHistoryRecords, historyObjects, historyRecords } from '../../src/domain/whiteboard/history-projection';

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
  it.each([
    ['orderKey',{orderKey:'changed'}],
    ['restoredFrom',{restoredFrom:'source-object'}],
    ['extensionData',{extensionData:{mermaid:{source:'graph TD; A-->B'},image:{assetId:'asset-1'},drawing:{points:[1,2,3]}}}],
    ['text',{text:`${'x'.repeat(500)}tail-a`}],
  ] as const)('uses the complete canonical object as compare truth for %s',(_field,change)=>{
    const before={...object('same',`${'x'.repeat(500)}tail-b`),extensionData:{mermaid:{source:'graph TD; A-->C'}}};
    const after={...before,...change} as WhiteboardObject;
    const result=compareHistoryObjects([before],[after]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({id:'same',change:'modified'});
    expect(result[0]!.before!.text).toHaveLength(500);
    expect(result[0]!.before!.objectDigest).not.toBe(result[0]!.after!.objectDigest);
  });
  it('retains tombstones and deleted parent/connector endpoint context without reviving them',()=>{
    const frame=object('frame','Frame'),child=object('child','Child','frame'),endpoint=object('endpoint','Endpoint'),edge=object('edge','',null,{from:'child',to:'endpoint'}),records=[{object:frame,deleted:true},{object:child,deleted:false},{object:endpoint,deleted:true},{object:edge,deleted:false}];
    const projected=historyRecords(records);
    expect(projected.find(value=>value.preview.object.id==='child')?.preview.parentDeleted).toBe(true);
    expect(projected.find(value=>value.preview.object.id==='edge')?.preview.connector).toMatchObject({fromDeleted:false,toDeleted:true});
    const changes=compareHistoryRecords(records,records.map(value=>value.object.id==='endpoint'?{...value,deleted:false}:value));
    expect(changes).toEqual([expect.objectContaining({id:'endpoint',change:'modified',changedFields:['deleted']})]);
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
