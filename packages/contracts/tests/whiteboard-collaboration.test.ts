import { expect,it } from 'vitest';
import { WhiteboardCommentCommand,whiteboardCollaborationOperations } from '../src/whiteboard-collaboration';

it('keeps collaboration HTTP commands closed so clients cannot forge actor or board identity',()=>{
  const command={type:'create-comment',requestId:crypto.randomUUID(),threadId:crypto.randomUUID(),commentId:crypto.randomUUID(),objectId:'note',body:'trusted',mentions:[],expectedRevision:0};
  expect(WhiteboardCommentCommand.safeParse(command).success).toBe(true);
  expect(WhiteboardCommentCommand.safeParse({...command,actorId:'forged'}).success).toBe(false);
  expect(whiteboardCollaborationOperations.dispatchComment.path).toBe('/whiteboards/:boardId/comments/commands');
  expect(whiteboardCollaborationOperations.restoreCheckpoint.in.safeParse({requestId:crypto.randomUUID(),expectedEpoch:2,expectedSeq:8}).success).toBe(true);
});
