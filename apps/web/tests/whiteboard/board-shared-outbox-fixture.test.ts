import { describe, expect, it } from 'vitest';
import { WhiteboardCommandBatch } from '@repo/contracts/whiteboard-document';
import { createWhiteboardDocument, executeCommands, readObjects, readPanelMetadata, SpatialRelationshipCommandPort } from '@repo/whiteboard-core';
import { sharedOutboxPanelCommands } from '../../e2e/support/board-shared-outbox-fixture';

describe('shared outbox existing-frame API fixture',()=>{
  it('passes actual API command contract and exposes editable core panel metadata',()=>{
    const commands=WhiteboardCommandBatch.parse(sharedOutboxPanelCommands(Array.from({length:8},(_,index)=>`outbox-frame-${index}`)));
    expect(commands).toHaveLength(8);
    for(const command of commands){
      expect(command.type).toBe('create');
      if(command.type!=='create')throw new Error('Expected create fixture');
      expect(command.object.kind).toBe('frame');
      expect(readPanelMetadata(command.object)).toMatchObject({version:1,mode:'freeform'});
    }
  });
  it('rejects projection-only panel kind and missing spatial metadata',()=>{
    const [valid]=sharedOutboxPanelCommands(['negative-frame']);
    expect(WhiteboardCommandBatch.safeParse([{...valid,object:{...valid!.object,kind:'panel'}}]).success).toBe(false);
    const canonical=WhiteboardCommandBatch.parse([{...valid,object:{...valid!.object,kind:'frame',extensionData:undefined}}])[0]!;
    if(canonical.type!=='create')throw new Error('Expected create fixture');
    expect(readPanelMetadata(canonical.object)).toBeNull();
  });
  it('supports the actual editor update-panel title command on every seeded frame',()=>{
    const doc=createWhiteboardDocument();
    try{
      executeCommands(doc,WhiteboardCommandBatch.parse(sharedOutboxPanelCommands(['first-frame','second-frame'])),'fixture');
      const port=new SpatialRelationshipCommandPort(doc);
      for(const frame of readObjects(doc)){
        const panel=readPanelMetadata(frame);expect(panel).not.toBeNull();
        port.dispatch({boardId:'outbox-board',clientId:'outbox-client',gestureId:frame.id,command:{type:'update-panel',id:frame.id,panel:panel!,text:`${frame.id} shared-tab-proof`}});
      }
      expect(readObjects(doc).every(frame=>frame.text.endsWith('shared-tab-proof'))).toBe(true);
    }finally{doc.destroy();}
  });
});
