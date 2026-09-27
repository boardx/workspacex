import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {computeRenderedLayoutHash} from '@repo/whiteboard-core';
import {WhiteboardOperationService} from '../../src/application/whiteboard/operation-service';

const boardId='00000000-0000-4000-8000-000000000001';
const principal={orgId:'org',userId:'user'} as any;
const body={schemaVersion:1 as const,artifactId:'artifact',orgId:'org',sourceRevision:'artifact-v1:7',diagramKind:'flowchart' as const,objects:[{sourceId:'n',kind:'node' as const,geometry:{x:0,y:0,width:100,height:50,rotation:0},text:'trusted',style:{shape:'rect',direction:'TD'},fromSourceId:null,toSourceId:null}],selectedSourceIds:[]};
const layout={...body,layoutHash:computeRenderedLayoutHash(body)};

function fixture(stored:Uint8Array=Buffer.from(JSON.stringify(layout)),revision='artifact-v1:7'){
  const issued:string[]=[];
  const audit={lockHead:async()=>({epoch:1,seq:0,actorRole:'owner'}),readArtifactSource:async(_s:any,_p:any,_a:string,r:string)=>r===revision?{versionId:'v7',objectKey:'key',contentHash:createHash('sha256').update(stored).digest('hex')}:null,issueArtifactLayoutBinding:async(_s:any,_p:any,_a:string,_v:string,h:string)=>{issued.push(h)},canReadArtifact:async()=>issued.includes(layout.layoutHash),replay:async()=>null,append:async()=>{},resolveActor:async()=>null} as any;
  const service=new WhiteboardOperationService({withTenant:async(_org:string,fn:any)=>fn({})} as any,{writeCommandsInTransaction:async()=>({epoch:1,seq:1})} as any,audit,()=>new Date('2026-09-27T00:00:00Z'),{get:async()=>stored},undefined,{capture:async()=>({}),record:async()=>{}} as any);
  return{service,issued};
}

describe('trusted artifact source verifier',()=>{
  it('issues a binding from an exact immutable layout snapshot',async()=>{
    const{service,issued}=fixture();
    const receipt=await service.handoff(principal,boardId,{requestId:'00000000-0000-4000-8000-000000000002',expectedRevision:{epoch:1,seq:0},layout,offset:{x:0,y:0}});
    expect(receipt.revision.seq).toBe(1);
    expect(issued).toEqual([layout.layoutHash]);
  });

  it('verifies the real Chat markdown/Fabric source path before issuing the binding',async()=>{
    const markdown=Buffer.from('Intro\n\n```mermaid\nflowchart TD\n    n["trusted"]\n```\n');
    const{service,issued}=fixture(markdown);
    await expect(service.handoff(principal,boardId,{requestId:'00000000-0000-4000-8000-000000000005',expectedRevision:{epoch:1,seq:0},layout,offset:{x:0,y:0}})).resolves.toMatchObject({revision:{seq:1}});
    expect(issued).toEqual([layout.layoutHash]);
  });

  it('rejects changed source content, forged digest, and changed revision before mutation',async()=>{
    const markdown=Buffer.from('```mermaid\nflowchart TD\n    n["trusted"]\n```');
    const forgedBody={...body,objects:[{...body.objects[0]!,text:'forged'}]};
    await expect(fixture(markdown).service.handoff(principal,boardId,{requestId:'00000000-0000-4000-8000-000000000003',expectedRevision:{epoch:1,seq:0},layout:{...forgedBody,layoutHash:computeRenderedLayoutHash(forgedBody)},offset:{x:0,y:0}})).rejects.toMatchObject({code:'FORBIDDEN'});
    const invalidHash={...layout,layoutHash:`layout-v1:${'0'.repeat(64)}`};
    const invalid=fixture(markdown);
    await expect(invalid.service.handoff(principal,boardId,{requestId:'00000000-0000-4000-8000-000000000006',expectedRevision:{epoch:1,seq:0},layout:invalidHash,offset:{x:0,y:0}})).rejects.toMatchObject({code:'VALIDATION_FAILED'});
    expect(invalid.issued).toEqual([]);
    await expect(fixture(markdown,'artifact-v1:8').service.handoff(principal,boardId,{requestId:'00000000-0000-4000-8000-000000000004',expectedRevision:{epoch:1,seq:0},layout,offset:{x:0,y:0}})).rejects.toMatchObject({code:'FORBIDDEN'});
  });
});
