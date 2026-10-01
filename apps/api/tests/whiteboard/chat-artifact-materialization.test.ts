import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveObjectPath } from '../../src/infrastructure/storage/object-store-path';
import { FsObjectStore } from '../../src/infrastructure/storage/fs-object-store';
import { materializeArtifact } from '../../src/application/artifact/materialize-artifact';
import type { ArtifactRepository } from '../../src/application/artifact/ports';
import { readArtifactSourceBytes } from '../../src/application/whiteboard/read-artifact-source-bytes';
import { computeContentHash } from '../../src/domain/artifact/content-hash';
import { storageKey } from '../../src/domain/artifact/materialization';
import { WhiteboardOperationService } from '../../src/application/whiteboard/operation-service';
import type { BoardArtifactSource, WhiteboardOperationAuditRepository } from '../../src/application/whiteboard/operation-ports';
import type { DatabasePort } from '../../src/application/ports/database.port';
import type { WhiteboardCollaborationStore } from '../../src/application/whiteboard/collaboration-ports';
import type { Principal } from '../../src/domain/principal';
import { computeRenderedLayoutHash } from '@repo/whiteboard-core';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const principal={orgId:'chat-integrity',userId:'user'} as Principal;
async function materialized(){
  const root=await mkdtemp(join(tmpdir(),'board-chat-source-'));roots.push(root);
  const store=new FsObjectStore(root);
  const markdown=new TextEncoder().encode('```mermaid\nflowchart TD\n    n["trusted"]\n```');
  const repo={createArtifact:async()=>{},headVersionNumber:async()=>0,createVersion:async()=>{}} as unknown as ArtifactRepository;
  const result=await materializeArtifact({store,repo,ids:{next:kind=>`${kind}-real-chat`}},{orgId:principal.orgId,projectId:null,source:'ai-generated',title:'Chat diagram',actorId:'user',parts:{'content.md':markdown,'provenance.json':new TextEncoder().encode('{"synthesized":true}')}});
  const source:BoardArtifactSource={versionId:result.versionId,objectKey:result.materializedKeys[0]!,contentHash:result.contentHash,chatMaterialization:{orgId:principal.orgId,artifactId:result.artifactId,versionNumber:result.versionNumber}};
  return {root,store,source,markdown};
}
describe('real Chat materialization integrity at Board handoff',()=>{
  it('reads both writer-produced files and validates the ordered version digest',async()=>{
    const {store,source,markdown}=await materialized();
    expect(source.contentHash).not.toBe(computeContentHash(markdown));
    expect(await readArtifactSourceBytes(store,source)).toEqual(markdown);
    await expect(readArtifactSourceBytes(store,{...source,objectKey:'other-org/artifacts/source/v1/content.md'})).rejects.toThrow('IDENTITY');
  });
  it('accepts the real two-file artifact through handoff and rejects corrupted provenance before any further write',async()=>{
    const {root,store,source}=await materialized();
    const write=vi.fn(async()=>({epoch:1,seq:1}));
    const audit={readArtifactSource:async()=>source,issueArtifactLayoutBinding:async()=>{},canReadArtifact:async()=>true,lockHead:async()=>({epoch:1,seq:0,actorRole:'owner'}),replay:async()=>null,append:async()=>{}} as unknown as WhiteboardOperationAuditRepository;
    const db={withTenant:async(_org:unknown,fn:(session:object)=>unknown)=>fn({})} as unknown as DatabasePort;
    const collaboration={writeCommandsInTransaction:write} as unknown as WhiteboardCollaborationStore;
    const record = vi.fn(async()=>{});
    const service=new WhiteboardOperationService(db,collaboration,audit,undefined,store,undefined,{
      capture:async()=>({epoch:1,seq:0,key:'fixture-before',hash:'fixture-hash',bytes:0,comments:[]}),record,
      get:async()=>null,readBefore:async()=>new Uint8Array(),checkComments:async()=>{},restoreComments:async()=>{},
    });
    const body={schemaVersion:1 as const,artifactId:source.chatMaterialization!.artifactId,orgId:principal.orgId,sourceRevision:'artifact-v1:1',diagramKind:'flowchart' as const,objects:[{sourceId:'n',kind:'node' as const,geometry:{x:50,y:40,width:100,height:50,rotation:0},text:'trusted',style:{shape:'rect',direction:'TD'},fromSourceId:null,toSourceId:null}],selectedSourceIds:[]};
    const request={requestId:'00000000-0000-4000-8000-000000000031',expectedRevision:{epoch:1,seq:0},layout:{...body,layoutHash:computeRenderedLayoutHash(body)},offset:{x:0,y:0}};
    await expect(service.handoff(principal,'00000000-0000-4000-8000-000000000030',request)).resolves.toMatchObject({revision:{seq:1}});
    expect(write).toHaveBeenCalledTimes(1); expect(record).toHaveBeenCalledTimes(1);
    await writeFile(resolveObjectPath(root,storageKey({...source.chatMaterialization!,fileName:'provenance.json'})),'tampered');
    await expect(service.handoff(principal,'00000000-0000-4000-8000-000000000030',{...request,requestId:'00000000-0000-4000-8000-000000000032'})).rejects.toMatchObject({code:'DEPENDENCY_UNAVAILABLE'});
    expect(write).toHaveBeenCalledTimes(1); expect(record).toHaveBeenCalledTimes(1);
  });
});
