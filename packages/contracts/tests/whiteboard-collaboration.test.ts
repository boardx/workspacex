import { expect,it } from 'vitest';
import { WhiteboardCommentCommand,whiteboardCollaborationOperations } from '../src/whiteboard-collaboration';

it('keeps collaboration HTTP commands closed so clients cannot forge actor or board identity',()=>{
  const command={type:'create-comment',requestId:crypto.randomUUID(),threadId:crypto.randomUUID(),commentId:crypto.randomUUID(),objectId:'note',worldPosition:null,body:'trusted',mentions:[],expectedRevision:0};
  expect(WhiteboardCommentCommand.safeParse(command).success).toBe(true);
  expect(WhiteboardCommentCommand.safeParse({...command,actorId:'forged'}).success).toBe(false);
  expect(whiteboardCollaborationOperations.dispatchComment.path).toBe('/whiteboards/:boardId/comments/commands');
  expect(whiteboardCollaborationOperations.restoreCheckpoint.in.safeParse({requestId:crypto.randomUUID(),expectedEpoch:2,expectedSeq:8}).success).toBe(true);
  const restoreEvent={type:'BoardRestored',eventId:crypto.randomUUID(),operationId:crypto.randomUUID(),boardId:crypto.randomUUID(),checkpointId:crypto.randomUUID(),previousEpoch:1,epoch:2,actorId:'owner',occurredAt:new Date().toISOString()};
  expect(whiteboardCollaborationOperations.restoreCheckpoint.out.safeParse({epoch:2,seq:0,replayed:false,event:restoreEvent,auditEvents:[]}).success).toBe(true);
  expect(whiteboardCollaborationOperations.dispatchCommands.in.safeParse({requestId:crypto.randomUUID(),epoch:1,commands:[{type:'restore',id:'note'}]}).success).toBe(true);
  expect(WhiteboardCommentCommand.safeParse({...command,objectId:null,worldPosition:{x:12,y:-4}}).success).toBe(true);
});
